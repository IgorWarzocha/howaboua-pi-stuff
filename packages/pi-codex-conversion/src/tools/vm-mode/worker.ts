import { parentPort, workerData } from "node:worker_threads";
import { createContext, runInContext, Script, SourceTextModule } from "node:vm";
import { contentOutputFactorySource } from "../code-mode/content-output.ts";
import { planVmCell, type VmBindings } from "./await-cell.ts";
import { VM_PRELUDE } from "./prelude.ts";
import type {
	VmCommand,
	VmMessage,
	VmOutcome,
	VmWorkerData,
} from "./protocol.ts";

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
const factory: unknown = runInContext(VM_PRELUDE, context, {
	filename: "vm-code-prelude.js",
});
if (typeof factory !== "function")
	throw new Error("VM Code prelude did not start");
// Only primitives cross back to the guest, including failures: host Errors expose Function.
const control = factory((kind: unknown, payload: unknown) => {
	try {
		bridge(String(kind), payload === undefined ? "" : String(payload));
		return undefined;
	} catch (error) {
		return errorMessage(error);
	}
}) as VmControl;
const exported = new Map<string, string>();
let cells = 0;
const IDENTIFIER = /^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u;
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
const resolvers = new Map<
	number,
	{ resolve(): void; reject(error: Error): void }
>();
const calls = new Map<number, Promise<void>>();

function send(message: VmMessage): void {
	parentPort?.postMessage(message);
}
function memory(): VmOutcome["memory"] {
	const usage = process.memoryUsage();
	return { heapUsed: usage.heapUsed, rss: usage.rss };
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
function isExit(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "VmExit"
	);
}
function errorMessage(error: unknown): string {
	return typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
		? error.message
		: String(error);
}
function scriptError(error: unknown): string {
	if (isExit(error)) return "";
	return errorMessage(error);
}

function bridge(kind: string, value: string): void {
	if (active === undefined)
		throw new Error("Start this operation in an active exec");
	switch (kind) {
		case "bind": {
			const binding: unknown = JSON.parse(value);
			if (
				!record(binding) ||
				typeof binding["name"] !== "string" ||
				!IDENTIFIER.test(binding["name"]) ||
				!["let", "const", "class", "function", "var"].includes(
					String(binding["kind"]),
				)
			)
				throw new Error("Invalid binding");
			exported.set(binding["name"], String(binding["kind"]));
			break;
		}
		case "call": {
			const call: unknown = JSON.parse(value);
			if (
				!record(call) ||
				!Number.isSafeInteger(call["id"]) ||
				typeof call["name"] !== "string" ||
				typeof call["json"] !== "string"
			)
				throw new Error("Invalid tool call");
			const id = Number(call["id"]);
			calls.set(
				id,
				new Promise<void>((resolve, reject) => {
					resolvers.set(id, { resolve, reject });
				}),
			);
			send({
				run: active,
				kind: "call",
				id,
				name: call["name"],
				json: call["json"],
			});
			break;
		}
		case "store": {
			const write: unknown = JSON.parse(value);
			if (
				!record(write) ||
				typeof write["key"] !== "string" ||
				(write["json"] !== undefined && typeof write["json"] !== "string")
			)
				throw new Error("Invalid stored value");
			send({
				run: active,
				kind: "store",
				key: write["key"],
				...(typeof write["json"] === "string" ? { json: write["json"] } : {}),
			});
			break;
		}
		case "text":
		case "image":
			emit(kind, value);
			break;
		case "notify":
			send({ run: active, kind: "notify", text: value });
			break;
		case "yield":
			send({ run: active, kind: "yield" });
			break;
		default:
			throw new Error("Unknown Code operation");
	}
}

function emit(kind: "text" | "image", value: string): void {
	if (truncated || active === undefined) return;
	outputChars += value.length;
	outputItems++;
	if (outputChars > 32 * 1024 * 1024 || outputItems > 10000) {
		truncated = true;
		send({
			run: active,
			kind: "output",
			items: [{ type: "input_text", text: "[VM Code output truncated]" }],
		});
		return;
	}
	if (kind === "text") {
		send({
			run: active,
			kind: "output",
			items: [{ type: "input_text", text: value }],
		});
		return;
	}
	const item: unknown = JSON.parse(value);
	if (
		!record(item) ||
		typeof item["image_url"] !== "string" ||
		!["auto", "low", "high", "original"].includes(String(item["detail"]))
	)
		throw new Error("Invalid image output");
	send({
		run: active,
		kind: "output",
		items: [
			{
				type: "input_image",
				image_url: item["image_url"],
				detail: item["detail"] as "auto" | "low" | "high" | "original",
			},
		],
	});
}

function finish(outcome: Omit<VmOutcome, "memory">): void {
	if (active === undefined) return;
	const run = active;
	if (resolvers.size) send({ run, kind: "cancel" });
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

function runScript(source: string): unknown {
	return new Script(source, { filename: "vm-code-cell.js" }).runInContext(
		context,
	);
}

function thrown(error: unknown): { name: string; message: string } {
	if (typeof error === "object" && error !== null) {
		const name =
			"name" in error && typeof error.name === "string" ? error.name : "";
		const message =
			"message" in error && typeof error.message === "string"
				? error.message
				: String(error);
		return { name, message };
	}
	return { name: "", message: String(error) };
}

function bindingState(name: string): "absent" | "global" | "lexical" {
	if (!IDENTIFIER.test(name))
		throw new SyntaxError(`Identifier '${name}' has already been declared`);
	if (
		runInContext(
			`Object.prototype.hasOwnProperty.call(globalThis, ${JSON.stringify(name)})`,
			context,
		) === true
	)
		return "global";
	try {
		runInContext(`void ${name}`, context);
		return "lexical";
	} catch (error) {
		const detail = thrown(error);
		if (
			detail.name === "ReferenceError" &&
			!detail.message.includes("before initialization")
		)
			return "absent";
		return "lexical";
	}
}

function declared(name: string): void {
	if (bindingState(name) !== "absent")
		throw new SyntaxError(`Identifier '${name}' has already been declared`);
}

function rejectConflicts(bindings: VmBindings): void {
	const seen = new Set<string>();
	for (const name of bindings.lexical) {
		if (
			seen.has(name) ||
			bindings.vars.includes(name) ||
			bindings.functions.includes(name)
		) {
			throw new SyntaxError(`Identifier '${name}' has already been declared`);
		}
		seen.add(name);
		declared(name);
	}
	for (const name of bindings.functions)
		if (bindingState(name) === "lexical" || lexicalExport(name)) declared(name);
	for (const name of bindings.vars)
		if (bindingState(name) === "lexical" || lexicalExport(name)) declared(name);
}

function lexicalExport(name: string): boolean {
	const kind = exported.get(name);
	return kind === "let" || kind === "const" || kind === "class";
}

async function settleGuest(): Promise<void> {
	for (let turn = 0; turn < 20; turn++) {
		flushGuest();
		await new Promise<void>((resolve) => setImmediate(resolve));
		if (control.pending() === 0) return;
		control.fail(failure || "VM Code stopped");
	}
}

async function finishFailure(message: string): Promise<void> {
	const text = message || "VM Code stopped";
	failure = text;
	control.fail(text);
	await settleGuest();
	finish({ error: text });
}

async function quiescent(completion?: Promise<unknown>): Promise<unknown> {
	let notify: () => void = () => {};
	const halted = new Promise<void>((resolve) => {
		notify = resolve;
	});
	let settled = completion === undefined;
	let exit: unknown;
	void completion?.then(
		() => {
			settled = true;
		},
		(error: unknown) => {
			settled = true;
			if (isExit(error)) exit = error;
			else if (!failure) failure = scriptError(error);
			notify();
		},
	);
	for (let turn = 0; turn < 10_000 || calls.size === 0; turn++) {
		if (failure || exit) return exit;
		const pending = [...calls.values()];
		if (pending.length)
			await Promise.race([Promise.allSettled(pending), halted]);
		if (failure || exit) return exit;
		flushGuest();
		await new Promise<void>((resolve) => setImmediate(resolve));
		if (failure || exit) return exit;
		if (calls.size === 0 && control.pending() === 0 && settled) return exit;
	}
	throw new Error("The script kept scheduling tool calls");
}

async function runModule(source: string): Promise<void> {
	const compiled = new SourceTextModule(source, {
		context,
		identifier: `vm-code://${++cells}`,
	});
	await compiled.link(() => {
		throw new Error("import is unavailable");
	});
	const exit = await quiescent(compiled.evaluate());
	if (isExit(exit)) throw exit;
}

async function run(
	message: Extract<VmCommand, { kind: "run" }>,
): Promise<void> {
	if (active !== undefined) throw new Error("An exec is already running");
	active = message.run;
	outputChars = 0;
	outputItems = 0;
	truncated = false;
	failure = undefined;
	control.configure(
		JSON.stringify(message.input.tools),
		JSON.stringify(message.input.store),
	);
	try {
		const planned = planVmCell(
			message.input.source,
			(name) => bindingState(name) !== "absent",
		);
		rejectConflicts(planned.bindings);
		if (planned.awaited) await runModule(planned.source);
		else {
			runScript(planned.source);
			await quiescent();
		}
		if (failure) {
			await finishFailure(failure);
			return;
		}
		finish({});
	} catch (error) {
		if (isExit(error)) {
			await settleGuest();
			finish({});
			return;
		}
		await finishFailure(failure || scriptError(error));
	}
}

function reply(message: Extract<VmCommand, { kind: "reply" }>): void {
	if (active !== message.run) return;
	const call = resolvers.get(message.id);
	if (!call) return;
	resolvers.delete(message.id);
	calls.delete(message.id);
	try {
		control.settle(
			message.id,
			message.json ?? "",
			message.error === undefined ? undefined : message.error,
		);
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
	if (message.kind === "run")
		void run(message).catch((error) => finish({ error: scriptError(error) }));
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
