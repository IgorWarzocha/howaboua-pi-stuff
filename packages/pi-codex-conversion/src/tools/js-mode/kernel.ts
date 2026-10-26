import { Worker } from "node:worker_threads";
import type { JsRuntime } from "./runtime.ts";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import type { JsCommand, JsInput, JsMessage, JsOutcome, JsSnapshot, JsWorkerData } from "./protocol.ts";

interface Callbacks {
	output(items: RuntimeContentItem[]): void;
	notify(text: string): void;
	yield(): void;
	request(id: number, name: string, value: unknown): Promise<unknown>;
}

/** A compiled WASM module is shared; each kernel owns a separate VM and thread. */
export class JsKernel {
	private readonly worker: Worker;
	private readonly interrupt: Int32Array;
	private next = 0;
	private active: { run: number; callbacks: Callbacks; resolve(value: JsOutcome): void; reject(error: Error): void } | undefined;
	private failure: Error | undefined;
	private stopping: Promise<void> | undefined;

	static async create(runtime: JsRuntime, heapBytes: number, snapshot?: JsSnapshot, managementClone = false): Promise<JsKernel> {
		const restored = snapshot ? { ...snapshot } : undefined;
		if (restored && !managementClone) delete restored.startup;
		return new JsKernel({ ...runtime, interrupt: new SharedArrayBuffer(4), heapBytes, ...(restored ? { snapshot: restored } : {}) });
	}
	private constructor(data: JsWorkerData) {
		this.interrupt = new Int32Array(data.interrupt);
		const entry = import.meta.url.endsWith(".ts") ? new URL("./worker.ts", import.meta.url) : new URL("./worker.js", import.meta.url);
		this.worker = new Worker(entry, { workerData: data, execArgv: [], stdout: true, stderr: true });
		// Engine diagnostics must not write into Pi's terminal or masquerade as cell output.
		this.worker.stdout.resume(); this.worker.stderr.resume();
		this.worker.on("message", (message: JsMessage) => {
			const active = this.active;
			if (!active || message.run !== active.run) return;
			try {
				switch (message.kind) {
					case "output": active.callbacks.output(message.items); break;
					case "notify": active.callbacks.notify(message.text); break;
					case "yield": active.callbacks.yield(); break;
					case "call": void this.request(message, active.callbacks); break;
					case "done": this.active = undefined; active.resolve(message.outcome); break;
				}
			} catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); void this.stop(); }
		});
		this.worker.once("error", error => this.fail(new Error("JS Notebook stopped before the cell completed; use notebook restart", { cause: error })));
		this.worker.once("exit", () => this.fail(new Error("JS Notebook stopped; use notebook restart to restore the last checkpoint")));
	}

	execute(input: JsInput, callbacks: Callbacks): Promise<JsOutcome> {
		if (this.failure || this.stopping) return Promise.reject(this.failure ?? new Error("JS Notebook is stopping"));
		if (this.active) return Promise.reject(new Error("A JS Notebook cell is already running"));
		return new Promise((resolve, reject) => {
			const run = ++this.next;
			this.active = { run, callbacks, resolve, reject };
			this.worker.postMessage({ kind: "run", run, input } satisfies JsCommand);
		});
	}
	async stop(): Promise<void> {
		this.stopping ??= (async () => { Atomics.store(this.interrupt, 0, 1); await this.worker.terminate(); })();
		await this.stopping;
	}
	private fail(error: Error): void { this.failure = error; this.active?.reject(error); this.active = undefined; }
	private async request(message: Extract<JsMessage, { kind: "call" }>, callbacks: Callbacks): Promise<void> {
		let reply: JsCommand;
		try {
			const result = await callbacks.request(message.id, message.name, message.json === "" ? undefined : JSON.parse(message.json));
			const json = result === undefined ? "" : JSON.stringify(result);
			if (typeof json !== "string") throw new Error("This tool result cannot be represented as JSON in JS Notebook");
			if (json.length > 32 * 1024 * 1024) throw new Error("Tool result exceeds the JS Notebook limit; request less data");
			reply = { kind: "reply", run: message.run, id: message.id, json };
		} catch (error) { reply = { kind: "reply", run: message.run, id: message.id, error: error instanceof Error ? error.message : String(error) }; }
		if (!this.stopping && this.active?.run === message.run) this.worker.postMessage(reply);
	}
}
