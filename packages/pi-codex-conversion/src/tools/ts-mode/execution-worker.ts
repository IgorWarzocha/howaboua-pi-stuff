import { execFile, fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import type { PortableState } from "./portable-state.ts";
import { assertPortableState } from "./state-storage.ts";
import type { TsWorkerInput, TsWorkerMessage } from "./worker-protocol.ts";

interface WorkerCallbacks {
	output(items: RuntimeContentItem[]): void;
	notify(text: string): void;
	yield(): void;
	request(operation: "tool" | "import", id: number, name: string, input: unknown): Promise<unknown>;
}

/** A process owns cwd, its heap, timers and its ordinary subprocess tree. The compiler stays in Pi. */
export class TsExecutionWorker {
	readonly result: Promise<PortableState>;
	private readonly worker: ChildProcess;
	private readonly requests = new Set<Promise<void>>();
	private stopPromise: Promise<void> | undefined;
	private readonly closed: Promise<void>;

	constructor(options: { cwd: string; heapMiB: number; input: TsWorkerInput; callbacks: WorkerCallbacks }) {
		this.worker = fork(fileURLToPath(import.meta.url.endsWith(".ts") ? new URL("./worker.ts", import.meta.url) : new URL("./worker.js", import.meta.url)), [], {
			cwd: options.cwd, detached: process.platform !== "win32", serialization: "advanced",
			execPath: process.execPath, execArgv: [`--max-old-space-size=${options.heapMiB}`],
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		this.closed = new Promise(resolve => this.worker.once("close", () => resolve()));
		this.result = new Promise((resolve, reject) => {
			let settled = false;
			const fail = (error: unknown): void => { if (!settled) { settled = true; reject(error); } };
			this.worker.on("message", (value: unknown) => {
				if (settled) return;
				try {
					assertMessage(value);
					switch (value.kind) {
						case "output": options.callbacks.output(value.items); break;
						case "notify": options.callbacks.notify(value.text); break;
						case "yield": options.callbacks.yield(); break;
						case "request": {
							const request = this.request(value, options.callbacks);
							this.requests.add(request);
							void request.finally(() => this.requests.delete(request));
							break;
						}
						case "done": settled = true; resolve(value.state); break;
						case "error": fail(new Error(value.error)); break;
					}
				} catch (error) { fail(error); }
			});
			this.worker.once("error", fail);
			this.worker.once("exit", (code, signal) => fail(new Error(`TS worker stopped (${signal ?? code}); reduce retained data or increase the heap budget if it exhausted memory`)));
			for (const stream of [this.worker.stdout, this.worker.stderr]) {
				stream?.setEncoding("utf8");
				stream?.on("data", (text: string) => options.callbacks.output([{ type: "input_text", text }]));
			}
			this.worker.send({ kind: "start", input: options.input }, error => { if (error) fail(error); });
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
	if (!record(value)) throw new Error("TS worker returned an invalid message; committed state is unchanged");
	switch (value["kind"]) {
		case "yield": return;
		case "error": if (typeof value["error"] === "string") return; break;
		case "notify": if (typeof value["text"] === "string") return; break;
		case "request": if ((value["operation"] === "tool" || value["operation"] === "import") && Number.isSafeInteger(value["id"]) && typeof value["name"] === "string") return; break;
		case "output": if (Array.isArray(value["items"]) && value["items"].every(item => record(item) && ((item["type"] === "input_text" && typeof item["text"] === "string") || (item["type"] === "input_image" && typeof item["image_url"] === "string")))) return; break;
		case "done": assertPortableState(value["state"]); return;
	}
	throw new Error("TS worker returned an invalid message; committed state is unchanged");
}
