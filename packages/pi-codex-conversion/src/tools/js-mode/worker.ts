import { parentPort, workerData } from "node:worker_threads";
import type { QuickJS as QuickJSInstance, JSValueHandle } from "quickjs-wasi";
import { JS_PRELUDE } from "./prelude.ts";
import { inspectJsBindings } from "./bindings.ts";
import { JsBindings } from "./managed-bindings.ts";
import { JsSupport } from "./support.ts";
import { captureJsData, releaseJsData, restoreJsData } from "./data-state.ts";
import type { JsCommand, JsInput, JsInventory, JsMessage, JsOutcome, JsWorkerData } from "./protocol.ts";

const data: JsWorkerData = workerData;
const { JSException, QuickJS }: typeof import("quickjs-wasi") = await import(data.moduleUrl);
const interrupt = new Int32Array(data.interrupt);
let vm: QuickJSInstance;
let controlToken: number;
let inventory: JsInventory;
let support: JsSupport;
let bindings: JsBindings;
let pins: string[] = data.snapshot?.pins ?? [];
let startup: "pending" | "running" | "done" | "failed" = "pending";
let startupFailure: string | undefined;
let userInput: JsInput | undefined;
const calls = new Map<number, { name: string; json: string; hooked: boolean }>();
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
			if (startup === "running") throw new Error("Pi tools are unavailable during startup hooks");
			const call: unknown = JSON.parse(value);
			if (!record(call) || !Number.isSafeInteger(call["id"]) || typeof call["name"] !== "string" || typeof call["json"] !== "string") throw new Error("Invalid tool call");
			calls.set(Number(call["id"]), { name: call["name"], json: call["json"], hooked: support.call("depth").consume(value => value.toNumber()) > 0 });
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
	send({ run: active, kind: "done", outcome: { bindings: inspectJsBindings(vm, inventory, "*", bindings), inventoryComplete: inventory.complete, hooks: hooks(), pins, ...outcome, heapBytes: vm.getMemoryUsage().memoryUsedSize } });
	active = undefined;
}

function snapshot(): NonNullable<JsOutcome["snapshot"]> {
	return { bytes: QuickJS.serializeSnapshot(vm.snapshot()), controller: controlToken, inventory, support: support.token, bindings: bindings.token, pins, startup: { status: startup === "running" ? "pending" : startup, ...(startupFailure === undefined ? {} : { error: startupFailure }) } };
}

function hooks(): NonNullable<JsOutcome["hooks"]> { return support.call("list").consume(value => JSON.parse(value.toString())); }

function captured(extra: Omit<JsOutcome, "heapBytes"> = {}): Omit<JsOutcome, "heapBytes"> {
	let pinState: JsOutcome["pinState"], pinError: string | undefined;
	try { if (pins.length) { pinState = captureJsData(vm, support, inventory, pins, bindings); pinState.pins = [...pins]; } }
	catch (error) { pinError = errorMessage(error); }
	// Capture graph identities before the native image containing their WeakMap.
	return { ...extra, ...(pinState ? { pinState } : {}), ...(pinError ? { pinError } : {}), snapshot: snapshot() };
}

function manage(input: JsInput): void {
	const operation = input.data;
	if (!operation) return;
	if (operation.action === "export") { finish({ data: captureJsData(vm, support, inventory, operation.names, bindings) }); return; }
	if (operation.action === "import") {
		restoreJsData(vm, support, inventory, operation.state, bindings);
		if (operation.pins) pins = [...operation.pins];
	} else if (operation.action === "pin") {
		const selected = [...new Set([...pins, ...operation.names])].sort();
		captureJsData(vm, support, inventory, selected, bindings); pins = selected;
	} else if (operation.action === "unpin") pins = pins.filter(name => !operation.names.includes(name));
	else {
		const protectedNames = new Map(pins.map(name => [name, "project pin; unpin first"]));
		for (const hook of hooks()) protectedNames.set(hook.name, "registered hook; remove its registration first");
		const release = releaseJsData(vm, inventory, operation.names, protectedNames, bindings);
		vm.runGC(); finish(captured({ release })); return;
	}
	finish(captured());
}

function drain(): void {
	// A worker is required: this public API drains all jobs, so infinite
	// microtask chains must remain terminable without blocking Pi's event loop.
	vm.executePendingJobs();
	const status: unknown = call("status").consume(value => JSON.parse(value.toString()));
	if (!record(status) || typeof status["done"] !== "boolean" || typeof status["pending"] !== "number") throw new Error("Invalid cell completion");
	// A tool awaiting its hooks is still pending in the immutable controller,
	// but cannot resume a stalled hook after its host reply has already arrived.
	if (!status["done"] && status["pending"] > 0 && calls.size > 0) return;
	if (!status["done"] || status["pending"] > 0) {
		finish({ fatal: true, error: status["done"] ? "The cell finished with outstanding tool calls. Await every tool call before the cell ends" : "The cell is waiting on a promise with no pending tool call to resume it" }); return;
	}
	const hookFailure = support.call("failure").consume(value => value.typeof === "undefined" ? undefined : value.toString());
	const error = hookFailure ?? (typeof status["error"] === "string" ? status["error"] : rejections.values().next().value);
	if (startup === "running") {
		if (error !== undefined) { startup = "failed"; startupFailure = error; finish({ error }); return; }
		startup = "done";
		const input = userInput; userInput = undefined;
		if (!input) throw new Error("Missing user cell after startup");
		// Startup was observed as a cell: clear its completion before user work.
		configure(input);
		startUser(input); return;
	}
	if (error !== undefined) finish({ error });
	else finish(captured());
}

function configure(input: JsInput): void {
	const tools = vm.newString(JSON.stringify(input.tools));
	try { call("configure", tools).dispose(); } finally { tools.dispose(); }
}
function hookEvent(value: unknown): JSValueHandle {
	const json = vm.newString(JSON.stringify(value));
	try { return support.call("event", json); } finally { json.dispose(); }
}
function startUser(input: JsInput): void {
	let result: JSValueHandle;
	try {
		result = bindings.execute(input.source ?? "");
	} catch (error) { finish({ error: errorMessage(error) }); return; }
	try { call("observe", result).dispose(); } finally { result.dispose(); }
	drain();
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
	support = new JsSupport(vm, data.snapshot?.support);
	bindings = new JsBindings(vm, inventory, data.snapshot?.bindings);
	startup = data.snapshot?.startup?.status ?? "pending";
	startupFailure = data.snapshot?.startup?.error;
	parentPort?.on("message", (message: JsCommand) => {
		try {
			if (message.kind === "run") {
				if (active !== undefined) throw new Error("A cell is already running");
				active = message.run; outputChars = 0; outputItems = 0; truncated = false; rejections.clear();
				configure(message.input);
				if (message.input.hook) {
					try {
						const { name, event } = message.input.hook;
						const fn = event === false ? vm.undefined : bindings.has(name) ? bindings.read(name) : vm.evalCode(name);
						try { support.register(name, event, fn); } finally { fn.dispose(); }
						if (startup === "failed") { startup = "pending"; startupFailure = undefined; } finish(captured());
					}
					catch (error) { finish({ error: errorMessage(error) }); }
					return;
				}
				if (message.input.inspect !== undefined) { finish({ bindings: inspectJsBindings(vm, inventory, message.input.inspect, bindings) }); return; }
				if (message.input.data) { try { manage(message.input); } catch (error) { finish({ error: errorMessage(error) }); } return; }
				if (message.input.management && message.input.source === undefined) { finish(captured()); return; }
				if (startup === "failed") { finish({ error: startupFailure ?? "Startup hooks failed; remove the hook with notebook hook event:false" }); return; }
				if (message.input.source === undefined) { finish(captured()); return; }
				if (startup === "pending") {
					startup = "running"; userInput = message.input;
					const event = hookEvent({ type: "startup" });
					try { const result = support.call("dispatch", event); try { call("observe", result).dispose(); } finally { result.dispose(); } } finally { event.dispose(); }
				} else { startUser(message.input); return; }
			} else {
				if (active !== message.run) return;
				const id = vm.newNumber(message.id), json = vm.newString(message.json ?? ""), error = message.error === undefined ? vm.undefined : vm.newString(message.error);
				const request = calls.get(message.id); calls.delete(message.id);
				try {
					if (!request || request.hooked) call("settle", id, json, error).dispose();
					else {
						const event = hookEvent({ type: "tool_result", toolName: request.name, input: request.json === "" ? undefined : JSON.parse(request.json), status: message.error === undefined ? "success" : "error", ...(message.error === undefined ? { result: message.json === "" || message.json === undefined ? undefined : JSON.parse(message.json) } : { error: message.error }) });
						const control = vm.importHandle(controlToken);
						try { support.call("settle", control, id, json, error, event).dispose(); } finally { control.dispose(); event.dispose(); }
					}
				} finally { id.dispose(); json.dispose(); error.dispose(); }
			}
			drain();
		} catch (error) { finish({ error: errorMessage(error), fatal: true }); }
	});
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
await main();
