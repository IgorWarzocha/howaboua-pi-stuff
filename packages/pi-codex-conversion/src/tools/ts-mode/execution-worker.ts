import { execFile, fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import { assertPortableState } from "./state-storage.ts";
import type { TsWorkerInput, TsWorkerMessage, TsWorkerOutcome } from "./worker-protocol.ts";

interface WorkerCallbacks {
	output(items: RuntimeContentItem[]): void;
	notify(text: string): void;
	yield(): void;
	request(operation: "tool" | "import", id: number, name: string, input: unknown): Promise<unknown>;
}

/** A process owns cwd, its heap, timers and its ordinary subprocess tree. The compiler stays in Pi. */
export class TsExecutionWorker {
	private readonly worker: ChildProcess;
	private readonly requests = new Set<Promise<void>>();
	private stopPromise: Promise<void> | undefined;
	private readonly closed: Promise<void>;
	private nextRun = 0;
	private active: { id: number; callbacks: WorkerCallbacks; resolve(value: TsWorkerOutcome): void; reject(error: unknown): void } | undefined;
	private failure: Error | undefined;
	private live = false;
	private liveReady = false;

	constructor(options: { cwd: string; heapMiB: number }) {
		this.worker = fork(fileURLToPath(import.meta.url.endsWith(".ts") ? new URL("./worker.ts", import.meta.url) : new URL("./worker.js", import.meta.url)), [], {
			cwd: options.cwd, detached: process.platform !== "win32", serialization: "advanced",
			execPath: process.execPath, execArgv: [`--max-old-space-size=${options.heapMiB}`],
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		this.closed = new Promise(resolve => this.worker.once("close", () => resolve()));
		const fail = (error: Error): void => { this.failure = error; this.active?.reject(error); this.active = undefined; };
		this.worker.on("message", (envelope: unknown) => {
				if (!record(envelope) || typeof envelope["runId"] !== "number") { fail(new Error("TS execution returned an invalid response")); return; }
				const active = this.active;
				if (!active || envelope["runId"] !== active.id) return;
				const value = envelope["message"];
				try {
					assertMessage(value);
					switch (value.kind) {
						case "output": active.callbacks.output(value.items); break;
						case "notify": active.callbacks.notify(value.text); break;
						case "yield": active.callbacks.yield(); break;
						case "request": {
							const request = this.request(value, active.callbacks);
							this.requests.add(request);
							void request.finally(() => this.requests.delete(request));
							break;
						}
						case "done": case "live-done":
							if (value.kind === "live-done") this.liveReady = !value.restoreFailed;
							this.active = undefined; active.resolve(value); break;
						case "error": this.active = undefined; active.reject(new Error(value.error)); break;
					}
				} catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
			});
			this.worker.once("error", fail);
			this.worker.once("exit", (code, signal) => fail(new Error(`TS worker stopped (${signal ?? code}); reduce retained data or increase the heap budget if it exhausted memory`)));
			for (const stream of [this.worker.stdout, this.worker.stderr]) {
				stream?.setEncoding("utf8");
				stream?.on("data", (text: string) => this.active?.callbacks.output([{ type: "input_text", text: this.live ? `[Notebook process output; originating cell unavailable]\n${text}` : text }]));
			}
	}

	execute(input: TsWorkerInput, callbacks: WorkerCallbacks): Promise<TsWorkerOutcome> {
		if (this.failure) return Promise.reject(this.failure);
		if (this.stopPromise) return Promise.reject(new Error("TS execution has stopped; restart the notebook"));
		if (this.active) return Promise.reject(new Error("A TS cell is already executing"));
		this.live ||= input.mode === "live";
		// Warm live cells already own their graph. Initial restoration, explicit
		// additions and failed-restore retries still carry the full saved state.
		const requestInput = input.mode === "live" && this.liveReady && !input.restore
			? { ...input, state: { ...input.state, roots: {}, nodes: {} } } : input;
		return new Promise((resolve, reject) => {
			const id = ++this.nextRun;
			this.active = { id, callbacks, resolve, reject };
			this.worker.send({ kind: "start", runId: id, input: requestInput }, error => { if (error) { this.active = undefined; reject(error); } });
		});
	}

	async stop(): Promise<void> {
		this.stopPromise ??= this.stopTree();
		await this.stopPromise;
	}

	private async stopTree(): Promise<void> {
		if (this.worker.pid) {
			if (process.platform === "win32") {
				await new Promise<void>(resolve => execFile("taskkill", ["/pid", String(this.worker.pid), "/T", "/F"], () => resolve()));
			} else {
				try { process.kill(-this.worker.pid, "SIGKILL"); }
				catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
			}
		}
		await this.closed;
		await Promise.allSettled(this.requests);
	}

	private async request(message: Extract<TsWorkerMessage, { kind: "request" }>, callbacks: WorkerCallbacks): Promise<void> {
		let reply: { id: number; value?: unknown; error?: string };
		try { reply = { id: message.id, value: await callbacks.request(message.operation, message.id, message.name, message.input) }; }
		catch (error) { reply = { id: message.id, error: error instanceof Error ? error.message : String(error) }; }
		if (!this.worker.connected) return;
		await new Promise<void>(resolve => this.worker.send(reply, () => resolve()));
	}
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertMessage(value: unknown): asserts value is TsWorkerMessage {
	if (!record(value)) throw new Error("TS execution returned an invalid response; restart the notebook from its durable checkpoint");
	switch (value["kind"]) {
		case "yield": return;
		case "error": if (typeof value["error"] === "string") return; break;
		case "notify": if (typeof value["text"] === "string") return; break;
		case "request": if ((value["operation"] === "tool" || value["operation"] === "import") && Number.isSafeInteger(value["id"]) && typeof value["name"] === "string") return; break;
		case "output": if (Array.isArray(value["items"]) && value["items"].every(item => record(item) && ((item["type"] === "input_text" && typeof item["text"] === "string") || (item["type"] === "input_image" && typeof item["image_url"] === "string")))) return; break;
		case "done": assertPortableState(value["state"]); return;
		case "live-done":
			assertPortableState(value["state"]);
			if (value["restoreFailed"] !== undefined && (!Array.isArray(value["restoreFailed"]) || !value["restoreFailed"].every(name => typeof name === "string"))) break;
			if (typeof value["sourceStarted"] === "boolean" && Array.isArray(value["skipped"]) && value["skipped"].every(item => record(item) && typeof item["name"] === "string" && typeof item["reason"] === "string") && (value["error"] === undefined || typeof value["error"] === "string") && (value["captureError"] === undefined || typeof value["captureError"] === "string")) return;
			break;
	}
	throw new Error("TS execution returned an invalid response; restart the notebook from its durable checkpoint");
}
