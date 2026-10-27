import { inspect } from "node:util";
import { serialize } from "node:v8";
import { AsyncLocalStorage } from "node:async_hooks";
import { CheckpointRestoreError, checkpointRoots, PortableGraph } from "./portable-state.ts";
import { LiveEvaluator } from "./live-evaluator.ts";
import type { TsWorkerCommand, TsWorkerEnvelope, TsWorkerInput, TsWorkerMessage } from "./worker-protocol.ts";

if (!process.send) throw new Error("TS execution requires a worker channel");
process.once("disconnect", () => process.exit(1));
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextRequest = 0;
const provenance = new AsyncLocalStorage<number>();
const send = (message: TsWorkerMessage): void => {
	const runId = provenance.getStore();
	if (runId === undefined) throw new Error("TS output has no originating cell");
	const envelope: TsWorkerEnvelope = { runId, message };
	process.send?.(envelope);
};
let started = false;
let activeRun: number | undefined;
let evaluator: LiveEvaluator | undefined;
const liveGraph = new PortableGraph();
const liveModuleCache = new Map<string, unknown>();
const liveModuleBindings = new Map<string, unknown>();
let liveStore: Record<string, unknown> = {};
let startupFinished = false;
let startupFailure: { name: string; message: string } | undefined;
const completedStartupHooks = new Set<string>();
const hookContext = new AsyncLocalStorage<"startup" | "tool_result">();
type LiveHook = { name: string; type: "startup" | "tool_result"; invoke: (event: unknown) => unknown };
let liveHooks: LiveHook[] = [];
const liveToolResults = new WeakMap<object, string>();
let liveConsoleOutput: (text: string) => void = () => {};
let restoreFailure: string | undefined;
let failedRestoreBindings: string[] = [];
process.on("message", (reply: TsWorkerCommand) => {
	if ("kind" in reply) {
		if (activeRun !== undefined || (started && reply.input.mode !== "live")) throw new Error("TS worker already started");
		started = true;
		activeRun = reply.runId;
		void provenance.run(reply.runId, async () => {
			try { await run(reply.input); }
			catch (error) { send({ kind: "error", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }); }
			finally { activeRun = undefined; }
		});
		return;
	}
	const request = pending.get(reply.id);
	if (!request) return;
	pending.delete(reply.id);
	if (reply.error !== undefined) request.reject(new Error(reply.error));
	else request.resolve(reply.value);
});
function request(operation: "tool" | "import", name: string, value: unknown): Promise<unknown> {
	if (provenance.getStore() !== activeRun || activeRun === undefined) return Promise.reject(new Error("The originating TS cell has finished; start this operation in an active cell"));
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
	const live = input.mode === "live";
	if (live && restoreFailure) { send({ kind: "live-done", state: input.state, skipped: [], sourceStarted: false, error: restoreFailure, restoreFailed: failedRestoreBindings }); return; }
	const graph = live ? liveGraph : new PortableGraph();
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
	if (live) liveConsoleOutput = text => {
		if (activeRun !== undefined && provenance.getStore() === activeRun) emit([{ type: "input_text", text }]);
	};
	const toolResults = live ? liveToolResults : new WeakMap<object, string>();
	const formatCommand: (value: Record<string, unknown>, plain: boolean) => string = new Function(`return (${input.commandFormatter});`)();
	const moduleCache = live ? liveModuleCache : new Map<string, unknown>();
	const moduleBindings = live ? liveModuleBindings : new Map<string, unknown>();
	const importModule = async (specifier: string, options?: ImportCallOptions): Promise<unknown> => {
		const bindingKey = JSON.stringify([specifier, options]);
		const bound = moduleBindings.get(bindingKey);
		if (bound) return bound;
		const resolved = await request("import", specifier, undefined);
		if (typeof resolved !== "string") throw new Error("TS import resolution did not return a module URL");
		const key = JSON.stringify([resolved, options]);
		const module: unknown = moduleCache.get(key) ?? await import(resolved, options);
		moduleCache.set(key, module);
		moduleBindings.set(bindingKey, module);
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
	const hooks: LiveHook[] = [];
	if (live) liveHooks = hooks;
	const dispatchHooks = async (type: "startup" | "tool_result", event: unknown): Promise<void> => {
		if (hookContext.getStore()) return;
		const selected = (live ? liveHooks : hooks).filter(hook => hook.type === type);
		if (type === "startup" && live && startupFailure) {
			if (selected.some(hook => hook.name === startupFailure?.name)) throw new Error(startupFailure.message);
			startupFailure = undefined;
		}
		await hookContext.run(type, async () => {
			for (const hook of selected) {
				if (type === "startup" && live && completedStartupHooks.has(hook.name)) continue;
				try {
					await hook.invoke(live && evaluator ? evaluator.values.clone(event) : structuredClone(event));
					if (type === "startup" && live) completedStartupHooks.add(hook.name);
				}
				catch (cause) {
					if (type === "startup") {
						const message = `TS startup hook ${hook.name} failed: ${cause instanceof Error ? cause.message : String(cause)}. The cell body did not run; earlier hook mutations remain. Unpin ${hook.name}, then retry`;
						if (live) startupFailure = { name: hook.name, message };
						throw new Error(message);
					}
					text(`TS hook ${hook.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
				}
			}
		});
	};
	const tools = Object.fromEntries(Object.entries(input.toolNames).map(([exposed, name]) => [exposed, async (...args: unknown[]) => {
		const toolInput = args.length <= 1 ? args[0] : args;
		let value: unknown;
		try {
			if (hookContext.getStore() === "startup") throw new Error("Pi tools are unavailable in startup hooks; run tool-dependent work in a normal cell after startup");
			value = await request("tool", name, toolInput);
			if (live && evaluator) value = evaluator.values.clone(value);
		}
		catch (cause) {
			await dispatchHooks("tool_result", { type: "tool_result", toolName: name, input: toolInput, status: "error", error: cause instanceof Error ? cause.message : String(cause) });
			throw live && evaluator ? evaluator.values.error(cause) : cause;
		}
		if (typeof value === "object" && value !== null) toolResults.set(value, name);
		await dispatchHooks("tool_result", { type: "tool_result", toolName: name, input: toolInput, status: "success", result: value });
		return value;
	}]));
	const restore = input.restore ?? (!live || !evaluator ? input.state : undefined);
	const restoredState = restore ?? { ...input.state, bindings: {}, roots: {}, nodes: {} };
	const recipes: Record<string, unknown> = {};
	for (const binding of Object.values(restoredState.bindings)) {
		if (!binding.module) continue;
		const module = await importModule(binding.module.specifier, binding.module.attributes ? { with: binding.module.attributes } : undefined);
		if (typeof module !== "object" || module === null) throw new Error(`Cannot restore module binding ${binding.name}`);
		recipes[binding.name] = binding.module.imported === "*" ? module : Reflect.get(module, binding.module.imported);
	}
	for (const node of Object.values(restoredState.nodes)) if (node.kind === "module") await importModule(node.specifier, node.attributes ? { with: node.attributes } : undefined);
	const retained = Object.values(restoredState.bindings).filter(binding => binding.kind !== "type");
	// Data is decoded after all recipe functions exist; functions close over these real lexical bindings.
	const lexicalPrelude = retained.filter(binding => binding.source).map(binding => {
		const recipe = `__recipes[${JSON.stringify(binding.name)}]`;
		return `${recipe} = __tsPrepareRecipe(${JSON.stringify(binding.name)}, ${binding.source}, ${binding.kind === "function"});`;
	}).join("\n");
	const deferred = new Set(checkpointRoots(restoredState));
	const declarations = (late: boolean): string => retained.filter(binding => deferred.has(binding.name) === late).map(binding => `${binding.kind === "const" || binding.kind === "import" ? "const" : "let"} ${binding.name} = __values[${JSON.stringify(binding.name)}];`).join("\n");
	const dataPrelude = declarations(false);
	const checkpointPrelude = declarations(true);
	const names = Object.keys(input.bindings).filter(name => input.bindings[name]?.kind !== "type");
	const hookBindings = Object.values(input.bindings).filter(binding => binding.hook && input.state.pins.includes(binding.name)).sort((a, b) => a.name.localeCompare(b.name));
	const body = `"use strict";\n${lexicalPrelude}\nconst __decoded = __decode(__recipes); const __values = __decoded.values;\n${dataPrelude}\nawait __decoded.restoreCheckpoints(name => eval(name));\n${checkpointPrelude}\nawait __tsInitializeHooks({${hookBindings.map(binding => binding.name).join(",")}});\n${input.javascript}\nreturn {${names.join(",")}};`;
	const AsyncFunction: new (...parameters: string[]) => (...args: unknown[]) => Promise<Record<string, unknown>> = Object.getPrototypeOf(async function () {}).constructor;
	let storeValues: Record<string, unknown> = {};
	const store = (key: string, value: unknown): void => { Object.defineProperty(storeValues, key, { value, enumerable: true, writable: true, configurable: true }); };
	const load = (key: string): unknown => Object.hasOwn(storeValues, key) ? storeValues[key] : undefined;
	if (live) {
		storeValues = liveStore;
		const decode = (resolved: Record<string, unknown>): ReturnType<PortableGraph["decode"]> => {
			const decoded = graph.decode(restoredState, name => resolved[name], node => {
				const module = moduleBindings.get(JSON.stringify([node.specifier, node.attributes ? { with: node.attributes } : undefined]));
				if (typeof module !== "object" || module === null) throw new Error(`Cannot restore module ${node.specifier}`);
				return node.imported === "*" ? module : Reflect.get(module, node.imported);
			});
			if (record(decoded.values["__tsStore"])) storeValues = decoded.values["__tsStore"];
			return decoded;
		};
		if (!evaluator) { evaluator = new LiveEvaluator(text => liveConsoleOutput(text)); graph.registerRealm(evaluator.intrinsics); }
		evaluator.install({ __recipes: recipes, __tsImport: async (specifier: string, options?: ImportCallOptions) => {
			try { return await importModule(specifier, options); }
			catch (cause) { throw evaluator?.values.error(cause); }
		},
			__tsPrepareRecipe: (name: string, value: unknown, forceName: boolean) => {
				if (typeof value === "function" && (forceName || !value.name)) Object.defineProperty(value, "name", { value: name, configurable: true });
				return value;
			},
			__tsRegisterRecipe: (name: string, value: unknown) => {
				if (typeof value === "function" && !value.name) Object.defineProperty(value, "name", { value: name, configurable: true });
				graph.registerRecipe(value, name); return value;
			},
			tools, ALL_TOOLS: evaluator.values.clone(input.toolMetadata), text, image, generatedImage,
			notify: (value: unknown) => send({ kind: "notify", text: stringify(value) }),
			yield_control: () => send({ kind: "yield" }), exit: () => { throw new Error("TS cell exited; earlier live mutations remain"); }, store, load });
		let error: string | undefined;
		let sourceStarted = false;
		try {
			if (restore) {
				try {
					if (lexicalPrelude) await evaluator.evaluate(lexicalPrelude);
					const decoded = decode(recipes);
					evaluator.install({ __restoredValues: decoded.values });
					if (dataPrelude) await evaluator.evaluate(dataPrelude.replaceAll("__values[", "__restoredValues["));
					await decoded.restoreCheckpoints(name => recipes[name]);
					if (checkpointPrelude) await evaluator.evaluate(checkpointPrelude.replaceAll("__values[", "__restoredValues["));
				} catch (cause) {
					failedRestoreBindings = cause instanceof CheckpointRestoreError ? cause.bindings : [...deferred];
					restoreFailure = `TS checkpoint restoration failed: ${cause instanceof Error ? cause.message : String(cause)}. The cell body did not run and the saved checkpoint was preserved. Unpin the affected checkpoint binding or reset before retrying`;
					throw new Error(restoreFailure);
				}
			}
			for (const binding of hookBindings) {
				const invoke: unknown = await evaluator.evaluate(binding.name);
				if (typeof invoke === "function" && binding.hook) hooks.push({ name: binding.name, type: binding.hook, invoke: event => invoke(event) });
			}
			if (!input.captureOnly && !startupFinished) { await dispatchHooks("startup", { type: "startup" }); startupFinished = true; }
			if (!input.captureOnly) { sourceStarted = true; await evaluator.evaluate(input.javascript); }
		} catch (cause) { error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause); }
		// Awaiting host replies cannot settle arbitrary user finally/catch continuations.
		// A terminal worker error makes the host stop this heap before another cell.
		if (pending.size) throw new Error(`The cell ended while tool or import calls were still running. Wait for every call to settle.${error ? `\n${error}` : ""}`);
		if (restoreFailure) { send({ kind: "live-done", state: input.state, skipped: [], sourceStarted: false, error: restoreFailure, restoreFailed: failedRestoreBindings }); return; }
		liveStore = storeValues;
		const values: Record<string, unknown> = {};
		const unreadable: { name: string; reason: string }[] = [];
		const captureBindings = sourceStarted || input.captureOnly ? input.bindings : input.state.bindings;
		for (const name of names.filter(name => Object.hasOwn(captureBindings, name))) {
			try { values[name] = await evaluator.evaluate(name); }
			catch (cause) { unreadable.push({ name, reason: cause instanceof Error ? cause.message : String(cause) }); }
		}
		if (Object.keys(storeValues).length) values["__tsStore"] = storeValues;
		try {
			await graph.prepareCheckpoints(values, captureBindings);
			const capture = graph.capture(values, captureBindings, input.state.pins, input.state.imports);
			if (serialize(capture.state).byteLength > input.maxStateBytes) throw new Error("TS checkpoint exceeds the storage budget; retain less data or increase the heap budget");
			send({ kind: "live-done", ...capture, sourceStarted, skipped: [...unreadable, ...capture.skipped], ...(error ? { error } : {}) });
		} catch (cause) {
			send({ kind: "live-done", sourceStarted, state: { version: 1, roots: {}, nodes: {}, bindings: {}, pins: [], imports: input.state.imports }, skipped: unreadable,
				captureError: cause instanceof Error ? cause.message : String(cause), ...(error ? { error } : {}) });
		}
		return;
	}
	const fn = new AsyncFunction("__recipes", "__decode", "__tsImport", "__tsRegisterRecipe", "__tsPrepareRecipe", "__tsInitializeHooks", "tools", "ALL_TOOLS", "text", "image", "generatedImage", "notify", "yield_control", "exit", "store", "load", body);
	const values = await fn(recipes, (resolved: Record<string, unknown>) => {
		const decoded = graph.decode(input.state, name => resolved[name], node => {
			const module = moduleBindings.get(JSON.stringify([node.specifier, node.attributes ? { with: node.attributes } : undefined]));
			if (typeof module !== "object" || module === null) throw new Error(`Cannot restore module ${node.specifier}`);
			return node.imported === "*" ? module : Reflect.get(module, node.imported);
		});
		const stored = decoded.values["__tsStore"];
		if (record(stored)) storeValues = stored;
		return decoded;
	}, importModule, (name: string, value: unknown) => {
		if (typeof value === "function" && !value.name) Object.defineProperty(value, "name", { value: name, configurable: true });
		graph.registerRecipe(value, name); return value;
	}, (name: string, value: unknown, forceName: boolean) => {
		if (typeof value === "function" && (forceName || !value.name)) Object.defineProperty(value, "name", { value: name, configurable: true });
		return value;
	}, async (values: Record<string, unknown>) => {
		for (const binding of hookBindings) {
			const invoke = values[binding.name];
			if (typeof invoke === "function" && binding.hook) hooks.push({ name: binding.name, type: binding.hook, invoke: event => invoke(event) });
		}
		await dispatchHooks("startup", { type: "startup" });
	}, tools, input.toolMetadata, text, image, generatedImage,
		(value: unknown) => send({ kind: "notify", text: stringify(value) }), () => send({ kind: "yield" }), () => { throw new Error("TS cell exited without committing state"); }, store, load);
	if (pending.size) throw new Error("TS cell has unawaited tool/import requests; await them before committing state");
	for (const key of Reflect.ownKeys(globalThis)) if (!initialGlobals.has(key)) throw new Error(`globalThis.${String(key)} cannot transfer; declare a top-level binding instead`);
	for (const binding of Object.values(input.bindings)) if (binding.module) graph.registerRecipe(values[binding.name], binding.name);
	// An unused fresh store is not a write: overlapping cells must not invent competing roots.
	if (Object.hasOwn(input.state.roots, "__tsStore") || Object.keys(storeValues).length) values["__tsStore"] = storeValues;
	await graph.prepareCheckpoints(values, input.bindings);
	const candidate = graph.encode(values, input.bindings, input.state.pins, input.state.imports);
	if (serialize(candidate).byteLength > input.maxStateBytes) throw new Error("TS retained state exceeds the session storage budget; retain less data or increase the heap budget");
	send({ kind: "done", state: candidate });
}
