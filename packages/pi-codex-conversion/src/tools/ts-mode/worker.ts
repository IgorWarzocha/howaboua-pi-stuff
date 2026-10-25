import { inspect } from "node:util";
import { serialize } from "node:v8";
import { PortableGraph } from "./portable-state.ts";
import type { TsWorkerCommand, TsWorkerInput, TsWorkerMessage } from "./worker-protocol.ts";

if (!process.send) throw new Error("TS execution requires a worker channel");
process.once("disconnect", () => process.exit(1));
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextRequest = 0;
const send = (message: TsWorkerMessage): void => { process.send?.(message); };
let started = false;
process.on("message", (reply: TsWorkerCommand) => {
	if ("kind" in reply) {
		if (started) throw new Error("TS worker already started");
		started = true;
		void run(reply.input).catch((error: unknown) => send({ kind: "error", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
		return;
	}
	const request = pending.get(reply.id);
	if (!request) return;
	pending.delete(reply.id);
	if (reply.error !== undefined) request.reject(new Error(reply.error));
	else request.resolve(reply.value);
});
function request(operation: "tool" | "import", name: string, value: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const id = ++nextRequest;
		pending.set(id, { resolve, reject });
		send({ kind: "request", id, operation, name, input: value });
	});
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	try { return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? `${item}n` : item, 2) ?? String(value); }
	catch { return inspect(value, { depth: 8, maxArrayLength: 1000 }); }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

async function run(input: TsWorkerInput): Promise<void> {
	const graph = new PortableGraph();
	const initialGlobals = new Set(Reflect.ownKeys(globalThis));
	let outputChars = 0;
	let outputItems = 0;
	let outputTruncated = false;
	const emit = (items: import("../code-mode/types.ts").RuntimeContentItem[]): void => {
		if (outputTruncated) return;
		for (const item of items) {
			const size = item.text?.length ?? item.image_url?.length ?? 0;
			if (outputChars + size > 32 * 1024 * 1024 || outputItems >= 10000) {
				outputTruncated = true;
				send({ kind: "output", items: [{ type: "input_text", text: "[TS cell output truncated]" }] });
				break;
			}
			outputChars += size; outputItems++;
			send({ kind: "output", items: [item] });
		}
	};
	const toolResults = new WeakMap<object, string>();
	const formatCommand: (value: Record<string, unknown>, plain: boolean) => string = new Function(`return (${input.commandFormatter});`)();
	const moduleCache = new Map<string, unknown>();
	const importModule = async (specifier: string, options?: ImportCallOptions): Promise<unknown> => {
		const key = JSON.stringify([specifier, options]);
		const existing = moduleCache.get(key);
		if (existing) return existing;
		const resolved = await request("import", specifier, undefined);
		if (typeof resolved !== "string") throw new Error("TS import resolution did not return a module URL");
		const module: unknown = await import(resolved, options);
		moduleCache.set(key, module);
		graph.registerModule(module, specifier, "*", options?.with);
		if (typeof module === "object" && module !== null) for (const name of Object.keys(module)) graph.registerModule(Reflect.get(module, name), specifier, name, options?.with);
		return module;
	};
	const text = (value: unknown): void => {
		const toolName = record(value) ? toolResults.get(value) : undefined;
		const hint = toolName ? input.outputHints[toolName] : undefined;
		const output = hint && record(value) && typeof value["output"] === "string" ? formatCommand(value, hint === "plain-command") : stringify(value);
		emit([{ type: "input_text", text: output }]);
	};
	const image = (value: unknown, detail?: unknown): void => {
		let url: string | undefined;
		let embeddedDetail: unknown;
		if (typeof value === "string") url = value;
		else if (record(value) && typeof value["image_url"] === "string") { url = value["image_url"]; embeddedDetail = value["detail"]; }
		else if (record(value) && value["type"] === "image" && typeof value["data"] === "string" && typeof value["mimeType"] === "string") {
			url = value["data"].toLowerCase().startsWith("data:") ? value["data"] : `data:${value["mimeType"]};base64,${value["data"]}`;
			if (record(value["_meta"])) embeddedDetail = value["_meta"]["codex/imageDetail"];
		}
		if (!url || !/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(url)) throw new Error("image expects base64 image data; remote image URLs are unavailable");
		const requested = detail ?? embeddedDetail ?? "high";
		if (requested !== "auto" && requested !== "low" && requested !== "high" && requested !== "original") throw new Error("image detail must be auto, low, high or original");
		emit([{ type: "input_image", image_url: url, detail: requested }]);
	};
	const generatedImage = (value: unknown): void => {
		if (!record(value) || typeof value["image_url"] !== "string" || (value["output_hint"] !== undefined && typeof value["output_hint"] !== "string")) throw new Error("generatedImage expects an image result with an optional string output_hint");
		image(value); if (value["output_hint"] !== undefined) text(value["output_hint"]);
	};
	const tools = Object.fromEntries(Object.entries(input.toolNames).map(([exposed, name]) => [exposed, async (...args: unknown[]) => {
		const value = await request("tool", name, args.length <= 1 ? args[0] : args);
		if (typeof value === "object" && value !== null) toolResults.set(value, name);
		return value;
	}]));
	const recipes: Record<string, unknown> = {};
	for (const binding of Object.values(input.state.bindings)) {
		if (!binding.module) continue;
		const module = await importModule(binding.module.specifier, binding.module.attributes ? { with: binding.module.attributes } : undefined);
		if (typeof module !== "object" || module === null) throw new Error(`Cannot restore module binding ${binding.name}`);
		recipes[binding.name] = binding.module.imported === "*" ? module : Reflect.get(module, binding.module.imported);
	}
	for (const node of Object.values(input.state.nodes)) if (node.kind === "module") await importModule(node.specifier, node.attributes ? { with: node.attributes } : undefined);
	const retained = Object.values(input.state.bindings).filter(binding => binding.kind !== "type");
	// Data is decoded after all recipe functions exist; functions close over these real lexical bindings.
	const lexicalPrelude = retained.filter(binding => binding.source).map(binding => {
		const recipe = `__recipes[${JSON.stringify(binding.name)}]`;
		return `${recipe} = __tsPrepareRecipe(${JSON.stringify(binding.name)}, ${binding.source}, ${binding.kind === "function"});`;
	}).join("\n");
	const dataPrelude = retained.map(binding => `${binding.kind === "const" || binding.kind === "import" ? "const" : "let"} ${binding.name} = __values[${JSON.stringify(binding.name)}];`).join("\n");
	const names = Object.keys(input.bindings).filter(name => input.bindings[name]?.kind !== "type");
	const body = `"use strict";\n${lexicalPrelude}\nconst __values = __decode(__recipes);\n${dataPrelude}\n${input.javascript}\nreturn {${names.join(",")}};`;
	const AsyncFunction: new (...parameters: string[]) => (...args: unknown[]) => Promise<Record<string, unknown>> = Object.getPrototypeOf(async function () {}).constructor;
	let storeValues: Record<string, unknown> = {};
	const store = (key: string, value: unknown): void => { Object.defineProperty(storeValues, key, { value, enumerable: true, writable: true, configurable: true }); };
	const load = (key: string): unknown => Object.hasOwn(storeValues, key) ? storeValues[key] : undefined;
	const fn = new AsyncFunction("__recipes", "__decode", "__tsImport", "__tsRegisterRecipe", "__tsPrepareRecipe", "tools", "ALL_TOOLS", "text", "image", "generatedImage", "notify", "yield_control", "exit", "store", "load", body);
	const values = await fn(recipes, (resolved: Record<string, unknown>) => {
		const decoded = graph.decode(input.state, name => resolved[name], node => {
			const module = moduleCache.get(JSON.stringify([node.specifier, node.attributes ? { with: node.attributes } : undefined]));
			if (typeof module !== "object" || module === null) throw new Error(`Cannot restore module ${node.specifier}`);
			return node.imported === "*" ? module : Reflect.get(module, node.imported);
		});
		const stored = decoded["__tsStore"];
		if (record(stored)) storeValues = stored;
		return decoded;
	}, importModule, (name: string, value: unknown) => {
		if (typeof value === "function" && !value.name) Object.defineProperty(value, "name", { value: name, configurable: true });
		graph.registerRecipe(value, name); return value;
	}, (name: string, value: unknown, forceName: boolean) => {
		if (typeof value === "function" && (forceName || !value.name)) Object.defineProperty(value, "name", { value: name, configurable: true });
		return value;
	}, tools, input.toolMetadata, text, image, generatedImage,
		(value: unknown) => send({ kind: "notify", text: stringify(value) }), () => send({ kind: "yield" }), () => { throw new Error("TS cell exited without committing state"); }, store, load);
	if (pending.size) throw new Error("TS cell has unawaited tool/import requests; await them before committing state");
	for (const key of Reflect.ownKeys(globalThis)) if (!initialGlobals.has(key)) throw new Error(`globalThis.${String(key)} cannot transfer; declare a top-level binding instead`);
	for (const binding of Object.values(input.bindings)) if (binding.module) graph.registerRecipe(values[binding.name], binding.name);
	// An unused fresh store is not a write: overlapping cells must not invent competing roots.
	if (Object.hasOwn(input.state.roots, "__tsStore") || Object.keys(storeValues).length) values["__tsStore"] = storeValues;
	const candidate = graph.encode(values, input.bindings, input.state.pins, input.state.imports);
	if (serialize(candidate).byteLength > input.maxStateBytes) throw new Error("TS retained state exceeds the session storage budget; retain less data or increase the heap budget");
	send({ kind: "done", state: candidate });
}
