import { parentPort, workerData } from "node:worker_threads";
import { createContext, runInContext, Script } from "node:vm";
import { contentOutputFactorySource } from "../code-mode/content-output.ts";
import { prepareVmCell } from "./await-cell.ts";
import { VM_PRELUDE } from "./prelude.ts";
import type { VmCommand, VmMessage, VmOutcome, VmWorkerData } from "./protocol.ts";

interface VmControl {
	configure(tools: string, store: string): void;
	settle(id: number, json: string, error: unknown): void;
	pending(): number;
	fail(message: string): void;
}

const data: VmWorkerData = workerData;
void data;
const context = createContext(Object.create(null), {
	codeGeneration: { strings: false, wasm: false },
	microtaskMode: "afterEvaluate",
});
const factory: unknown = runInContext(VM_PRELUDE, context, { filename: "vm-code-prelude.js" });
if (typeof factory !== "function") throw new Error("VM Code prelude did not start");
const control = factory((kind: unknown, payload: unknown) => bridge(String(kind), payload === undefined ? "" : String(payload))) as VmControl;
runInContext(
	`Object.defineProperty(globalThis, "content", { value: (${contentOutputFactorySource})(globalThis.text, globalThis.image), configurable: false, writable: false })`,
	context,
	{ filename: "vm-code-content.js" },
);

let active: number | undefined;
let outputChars = 0;
let outputItems = 0;
let truncated = false;
let failure: string | undefined;
const resolvers = new Map<number, { resolve(): void; reject(error: Error): void }>();
const calls = new Map<number, Promise<void>>();

function send(message: VmMessage): void { parentPort?.postMessage(message); }
function memory(): VmOutcome["memory"] {
	const usage = process.memoryUsage();
	return { heapUsed: usage.heapUsed, rss: usage.rss };
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
function isExit(error: unknown): boolean {
	return typeof error === "object" && error !== null && "name" in error && error.name === "VmExit";
}
function errorMessage(error: unknown): string {
	return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
		? error.message
		: String(error);
}
function scriptError(error: unknown): string {
	if (isExit(error)) return "";
	return errorMessage(error);
}

function bridge(kind: string, value: string): void {
	if (active === undefined) throw new Error("Start this operation in an active exec");
	switch (kind) {
		case "call": {
			const call: unknown = JSON.parse(value);
			if (!record(call) || !Number.isSafeInteger(call["id"]) || typeof call["name"] !== "string" || typeof call["json"] !== "string")
				throw new Error("Invalid tool call");
			const id = Number(call["id"]);
			calls.set(id, new Promise<void>((resolve, reject) => { resolvers.set(id, { resolve, reject }); }));
			send({ run: active, kind: "call", id, name: call["name"], json: call["json"] });
			break;
		}
		case "store": {
			const write: unknown = JSON.parse(value);
			if (!record(write) || typeof write["key"] !== "string" || write["json"] !== undefined && typeof write["json"] !== "string")
				throw new Error("Invalid stored value");
			send({ run: active, kind: "store", key: write["key"], ...(typeof write["json"] === "string" ? { json: write["json"] } : {}) });
			break;
		}
		case "text":
		case "image":
			emit(kind, value);
			break;
		case "notify": send({ run: active, kind: "notify", text: value }); break;
		case "yield": send({ run: active, kind: "yield" }); break;
		default: throw new Error("Unknown Code operation");
	}
}

function emit(kind: "text" | "image", value: string): void {
	if (truncated || active === undefined) return;
	outputChars += value.length;
	outputItems++;
	if (outputChars > 32 * 1024 * 1024 || outputItems > 10000) {
		truncated = true;
		send({ run: active, kind: "output", items: [{ type: "input_text", text: "[VM Code output truncated]" }] });
		return;
	}
	if (kind === "text") {
		send({ run: active, kind: "output", items: [{ type: "input_text", text: value }] });
		return;
	}
	const item: unknown = JSON.parse(value);
	if (!record(item) || typeof item["image_url"] !== "string" || !["auto", "low", "high", "original"].includes(String(item["detail"])))
		throw new Error("Invalid image output");
	send({ run: active, kind: "output", items: [{ type: "input_image", image_url: item["image_url"], detail: item["detail"] as "auto" | "low" | "high" | "original" }] });
}

function finish(outcome: Omit<VmOutcome, "memory">): void {
	if (active === undefined) return;
	const run = active;
	active = undefined;
	failure = undefined;
	resolvers.clear();
	calls.clear();
	send({ run, kind: "done", outcome: { ...outcome, memory: memory() } });
}

function flushGuest(): void {
	// Host replies resolve guest promises, but those callbacks run only on the next evaluation.
	runInContext("void 0", context);
}

async function quiescent(completion?: Promise<unknown>): Promise<void> {
	let settled = completion === undefined;
	void completion?.then(() => { settled = true; }, (error: unknown) => {
		settled = true;
		if (!isExit(error) && !failure) failure = scriptError(error);
	});
	for (let turn = 0; turn < 10_000 || calls.size === 0; turn++) {
		const pending = [...calls.values()];
		if (pending.length) await Promise.allSettled(pending);
		flushGuest();
		await new Promise<void>(resolve => setImmediate(resolve));
		if (failure) return;
		if (calls.size === 0 && control.pending() === 0 && settled) return;
	}
	throw new Error("The script kept scheduling tool calls");
}

async function run(message: Extract<VmCommand, { kind: "run" }>): Promise<void> {
	if (active !== undefined) throw new Error("An exec is already running");
	active = message.run;
	outputChars = 0;
	outputItems = 0;
	truncated = false;
	failure = undefined;
	control.configure(JSON.stringify(message.input.tools), JSON.stringify(message.input.store));
	try {
		const prepared = prepareVmCell(message.input.source);
		const value: unknown = new Script(prepared.source, { filename: "vm-code-cell.js" }).runInContext(context);
		const completion = prepared.awaited && typeof value === "object" && value !== null && "then" in value && typeof value.then === "function"
			? value as Promise<unknown>
			: undefined;
		if (prepared.awaited && !completion) throw new Error("Top-level await did not produce a promise");
		await quiescent(completion);
		if (failure) control.fail(failure);
		finish(failure ? { error: failure } : {});
	} catch (error) {
		const message = scriptError(error);
		control.fail(message || "VM Code stopped");
		finish(isExit(error) ? {} : { error: failure ?? message });
	}
}

function reply(message: Extract<VmCommand, { kind: "reply" }>): void {
	if (active !== message.run) return;
	const call = resolvers.get(message.id);
	if (!call) return;
	resolvers.delete(message.id);
	calls.delete(message.id);
	try {
		control.settle(message.id, message.json ?? "", message.error === undefined ? undefined : message.error);
		call.resolve();
	} catch (error) {
		call.reject(new Error(errorMessage(error)));
		failure = scriptError(error);
	}
}

parentPort?.on("message", (message: VmCommand) => {
	if (message.kind === "sample") {
		send({ kind: "sample", memory: memory() });
		return;
	}
	if (message.kind === "run") void run(message).catch(error => finish({ error: scriptError(error) }));
	else reply(message);
});

process.on("unhandledRejection", (reason) => {
	if (active === undefined || failure) return;
	failure = scriptError(reason);
});
process.on("uncaughtException", (error) => {
	if (active === undefined || failure) return;
	failure = scriptError(error);
});
