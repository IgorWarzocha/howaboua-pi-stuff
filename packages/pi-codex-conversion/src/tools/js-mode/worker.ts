import { parentPort, workerData } from "node:worker_threads";
import type { QuickJS as QuickJSInstance, JSValueHandle } from "quickjs-wasi";
import { JS_PRELUDE } from "./prelude.ts";
import { contentOutputFactorySource } from "../code-mode/content-output.ts";
import type { JsCommand, JsMessage, JsOutcome, JsWorkerData } from "./protocol.ts";

const data: JsWorkerData = workerData;
const { JSException, QuickJS }: typeof import("quickjs-wasi") = await import(data.moduleUrl);
const interrupt = new Int32Array(data.interrupt);
let vm: QuickJSInstance | undefined;
let control: JSValueHandle | undefined;
let active: number | undefined;
let outputChars = 0;
let outputItems = 0;
let truncated = false;
const calls = new Set<number>();
const rejections = new Map<number, string>();

function send(message: JsMessage): void { parentPort?.postMessage(message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

function bridge(kind: JSValueHandle, payload: JSValueHandle): JSValueHandle {
	if (active === undefined || !vm) throw new Error("Start this operation in an active cell");
	const value = payload.toString();
	switch (kind.toString()) {
		case "call": {
			const call: unknown = JSON.parse(value);
			if (!record(call) || !Number.isSafeInteger(call["id"]) || typeof call["name"] !== "string" || typeof call["json"] !== "string") throw new Error("Invalid tool call");
			calls.add(Number(call["id"]));
			send({ run: active, kind: "call", id: Number(call["id"]), name: call["name"], json: call["json"] }); break;
		}
		case "store": {
			const write: unknown = JSON.parse(value);
			if (!record(write) || typeof write["key"] !== "string" || write["json"] !== undefined && typeof write["json"] !== "string") throw new Error("Invalid stored value");
			send({ run: active, kind: "store", key: write["key"], ...(typeof write["json"] === "string" ? { json: write["json"] } : {}) }); break;
		}
		case "text": case "image": {
			if (truncated) break;
			outputChars += value.length; outputItems++;
			if (outputChars > 32 * 1024 * 1024 || outputItems > 10000) {
				truncated = true;
				send({ run: active, kind: "output", items: [{ type: "input_text", text: "[QuickJS Code output truncated]" }] }); break;
			}
			if (kind.toString() === "text") send({ run: active, kind: "output", items: [{ type: "input_text", text: value }] });
			else {
				const item: unknown = JSON.parse(value);
				if (!record(item) || typeof item["image_url"] !== "string" || !["auto", "low", "high", "original"].includes(String(item["detail"]))) throw new Error("Invalid image output");
				send({ run: active, kind: "output", items: [{ type: "input_image", image_url: item["image_url"], detail: item["detail"] as "auto" | "low" | "high" | "original" }] });
			}
			break;
		}
		case "notify": send({ run: active, kind: "notify", text: value }); break;
		case "yield": send({ run: active, kind: "yield" }); break;
		default: throw new Error("Unknown Code operation");
	}
	return vm.undefined;
}

function call(name: string, ...args: JSValueHandle[]): JSValueHandle {
	if (!vm || !control) throw new Error("No active cell");
	const fn = control.getProp(name);
	try { return vm.callFunction(fn, control, ...args); } finally { fn.dispose(); }
}

function errorMessage(error: unknown): string {
	try { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
	finally { if (error instanceof JSException) error.dispose(); }
}

function finish(outcome: JsOutcome): void {
	if (active === undefined) return;
	const run = active;
	// Dispose before advertising this thread as reusable. No roots or queued jobs
	// from the old VM may survive into the next run.
	control?.dispose(); control = undefined;
	vm?.dispose(); vm = undefined;
	active = undefined; calls.clear(); rejections.clear();
	send({ run, kind: "done", outcome });
}

function drain(): void {
	if (!vm) return;
	// An infinite job chain can block this worker; the host owns hard termination.
	vm.executePendingJobs();
	const status: unknown = call("status").consume(value => JSON.parse(value.toString()));
	if (!record(status) || typeof status["done"] !== "boolean" || typeof status["pending"] !== "number") throw new Error("Invalid cell completion");
	if (!status["done"] && status["pending"] > 0 && calls.size > 0) return;
	if (!status["done"] || status["pending"] > 0) {
		finish({ error: status["done"] ? "The cell finished with outstanding tool calls. Await every tool call before the cell ends" : "The cell is waiting on a promise with no pending tool call to resume it" }); return;
	}
	const error = typeof status["error"] === "string" ? status["error"] : rejections.values().next().value;
	finish(error === undefined ? {} : { error });
}

async function run(message: Extract<JsCommand, { kind: "run" }>): Promise<void> {
	if (active !== undefined) throw new Error("A cell is already running");
	active = message.run; outputChars = 0; outputItems = 0; truncated = false;
	vm = await QuickJS.create({ wasm: data.wasm, memoryLimit: data.heapBytes,
		interruptHandler: () => Atomics.load(interrupt, 0) !== 0,
		onUnhandledRejection: (promise: JSValueHandle, reason: JSValueHandle, handled: boolean) => {
			if (handled) rejections.delete(promise.identity);
			else { try { rejections.set(promise.identity, reason.toString()); } catch { rejections.set(promise.identity, "Unhandled promise rejection"); } }
		} });
	const init = vm.evalCode(JS_PRELUDE, "quickjs-code-prelude.js");
	const fn = vm.newFunction("quickjs-code.bridge", bridge);
	try { control = vm.callFunction(init, vm.undefined, fn); } finally { init.dispose(); fn.dispose(); }
	vm.evalCode(`Object.defineProperty(globalThis, "content", { value: (${contentOutputFactorySource})(globalThis.text, globalThis.image), configurable: false, writable: false })`, "quickjs-code-content.js").dispose();
	const tools = vm.newString(JSON.stringify(message.input.tools));
	const store = vm.newString(JSON.stringify(message.input.store));
	try { call("configure", tools, store).dispose(); } finally { tools.dispose(); store.dispose(); }
	const result = vm.evalCode(`(async () => {\n${message.input.source}\n})()`, "quickjs-code-cell.js");
	try { call("observe", result).dispose(); } finally { result.dispose(); }
	drain();
}

function reply(message: Extract<JsCommand, { kind: "reply" }>): void {
	if (active !== message.run || !vm || !calls.delete(message.id)) return;
	const id = vm.newNumber(message.id), json = vm.newString(message.json ?? ""), error = message.error === undefined ? vm.undefined : vm.newString(message.error);
	try { call("settle", id, json, error).dispose(); } finally { id.dispose(); json.dispose(); error.dispose(); }
	drain();
}

parentPort?.on("message", (message: JsCommand) => {
	if (message.kind === "run") void run(message).catch(error => finish({ error: errorMessage(error) }));
	else { try { reply(message); } catch (error) { finish({ error: errorMessage(error) }); } }
});
