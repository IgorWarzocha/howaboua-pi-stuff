import { parentPort, workerData } from "node:worker_threads";
import { EvalFlags, JSException, QuickJS, type JSValueHandle } from "quickjs-wasi";
import { JS_PRELUDE } from "./prelude.ts";
import { inspectJsBindings, jsDeclarations } from "./bindings.ts";
import type { JsCommand, JsInventory, JsMessage, JsOutcome, JsWorkerData } from "./protocol.ts";

const data: JsWorkerData = workerData;
const interrupt = new Int32Array(data.interrupt);
let vm: QuickJS;
let controlToken: number;
let inventory: JsInventory;
let active: number | undefined;
let outputChars = 0;
let outputItems = 0;
let truncated = false;
const rejections = new Map<number, string>();

function send(message: JsMessage): void {
	const bytes = message.kind === "done" ? message.outcome.snapshot?.bytes : undefined;
	parentPort?.postMessage(message, bytes?.buffer instanceof ArrayBuffer ? [bytes.buffer] : []);
}
function bridge(kind: JSValueHandle, payload: JSValueHandle): JSValueHandle {
	if (active === undefined) throw new Error("Start this operation in an active cell");
	const value = payload.toString();
	switch (kind.toString()) {
		case "call": {
			const call: unknown = JSON.parse(value);
			if (!record(call) || !Number.isSafeInteger(call["id"]) || typeof call["name"] !== "string" || typeof call["json"] !== "string") throw new Error("Invalid tool call");
			send({ run: active, kind: "call", id: Number(call["id"]), name: call["name"], json: call["json"] }); break;
		}
		case "text": case "image": {
			if (truncated) break;
			outputChars += value.length; outputItems++;
			if (outputChars > 32 * 1024 * 1024 || outputItems > 10000) {
				truncated = true;
				send({ run: active, kind: "output", items: [{ type: "input_text", text: "[JS Notebook output truncated]" }] }); break;
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
		default: throw new Error("Unknown notebook operation");
	}
	return vm.undefined;
}

function call(name: string, ...args: JSValueHandle[]): JSValueHandle {
	const control = vm.importHandle(controlToken);
	const fn = control.getProp(name);
	try { return vm.callFunction(fn, control, ...args); } finally { fn.dispose(); control.dispose(); }
}

function errorMessage(error: unknown): string {
	try { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
	finally { if (error instanceof JSException) error.dispose(); }
}

function finish(outcome: Omit<JsOutcome, "heapBytes">): void {
	if (active === undefined) return;
	send({ run: active, kind: "done", outcome: { bindings: inspectJsBindings(vm, inventory), inventoryComplete: inventory.complete, ...outcome, heapBytes: vm.getMemoryUsage().memoryUsedSize } });
	active = undefined;
}

function snapshot(): NonNullable<JsOutcome["snapshot"]> {
	return { bytes: QuickJS.serializeSnapshot(vm.snapshot()), controller: controlToken, inventory };
}

function drain(): void {
	// A worker is required: this public API drains all jobs, so infinite
	// microtask chains must remain terminable without blocking Pi's event loop.
	vm.executePendingJobs();
	const status: unknown = call("status").consume(value => JSON.parse(value.toString()));
	if (!record(status) || typeof status["done"] !== "boolean" || typeof status["pending"] !== "number") throw new Error("Invalid cell completion");
	if (!status["done"] && status["pending"] > 0) return;
	if (!status["done"] || status["pending"] > 0) {
		finish({ fatal: true, error: status["done"] ? "The cell finished with outstanding tool calls. Await every tool call before the cell ends" : "The cell is waiting on a promise with no pending tool call to resume it" }); return;
	}
	const error = typeof status["error"] === "string" ? status["error"] : rejections.values().next().value;
	if (error !== undefined) finish({ error });
	else finish({ snapshot: snapshot() });
}

async function main(): Promise<void> {
	const options = { wasm: data.wasm, memoryLimit: data.heapBytes, interruptHandler: () => Atomics.load(interrupt, 0) !== 0,
		onUnhandledRejection: (promise: JSValueHandle, reason: JSValueHandle, handled: boolean) => {
			if (handled) rejections.delete(promise.identity);
			else { try { rejections.set(promise.identity, reason.toString()); } catch { rejections.set(promise.identity, "Unhandled promise rejection"); } }
		} };
	if (data.snapshot) {
		vm = await QuickJS.restore(QuickJS.deserializeSnapshot(data.snapshot.bytes), options);
		vm.registerHostCallback("js-notebook.bridge", bridge);
		controlToken = data.snapshot.controller;
	} else {
		vm = await QuickJS.create(options);
		const init = vm.evalCode(JS_PRELUDE, "js-notebook-prelude.js");
		const fn = vm.newFunction("js-notebook.bridge", bridge);
		try {
			// This one boot handle owns the permanent root carried by every image.
			// Imported handles used for later calls are disposed before snapshotting.
			const control = vm.callFunction(init, vm.undefined, fn);
			controlToken = vm.exportHandle(control);
		} finally { init.dispose(); fn.dispose(); }
	}
	// Old images still restore their entire heap. Never invent an inventory for
	// lexical names which were created before declaration tracking existed.
	inventory = data.snapshot?.inventory ?? { declarations: [], baseline: vm.global.getOwnPropertyNames(), complete: !data.snapshot };
	parentPort?.on("message", (message: JsCommand) => {
		try {
			if (message.kind === "run") {
				if (active !== undefined) throw new Error("A cell is already running");
				active = message.run; outputChars = 0; outputItems = 0; truncated = false; rejections.clear();
				const tools = vm.newString(JSON.stringify(message.input.tools));
				try { call("configure", tools).dispose(); } finally { tools.dispose(); }
				if (message.input.inspect !== undefined) { finish({ bindings: inspectJsBindings(vm, inventory, message.input.inspect) }); return; }
				if (message.input.source === undefined) { finish({ snapshot: snapshot() }); return; }
				let result: JSValueHandle;
				try {
					const declarations = jsDeclarations(message.input.source);
					result = vm.evalCode(message.input.source, "js-notebook-cell.js", EvalFlags.ASYNC);
					for (const declaration of declarations) if (!inventory.declarations.some(binding => binding.name === declaration.name)) inventory.declarations.push(declaration);
				}
				catch (error) { finish({ error: errorMessage(error) }); return; }
				try { call("observe", result).dispose(); } finally { result.dispose(); }
			} else {
				if (active !== message.run) return;
				const id = vm.newNumber(message.id), json = vm.newString(message.json ?? ""), error = message.error === undefined ? vm.undefined : vm.newString(message.error);
				try { call("settle", id, json, error).dispose(); } finally { id.dispose(); json.dispose(); error.dispose(); }
			}
			drain();
		} catch (error) { finish({ error: errorMessage(error), fatal: true }); }
	});
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
await main();
