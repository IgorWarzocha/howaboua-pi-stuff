import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_CHARS = 16 * 1024;
const SHUTDOWN_GRACE_MS = 1_000;

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

interface JsonRpcMessage extends Record<string, unknown> {
	jsonrpc: "2.0";
	id?: number | string | undefined;
	method?: string | undefined;
	params?: unknown;
	result?: unknown;
	error?: unknown;
}

export class OneShotLspProcess {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, PendingRequest>();
	private nextId = 1;
	private input = Buffer.alloc(0);
	private stderr = "";
	private stopped = false;

	constructor(options: { deno: string; cwd: string; signal: AbortSignal }) {
		this.child = spawn(options.deno, ["lsp", "--quiet"], {
			cwd: options.cwd,
			env: { ...process.env, DENO_NO_UPDATE_CHECK: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
		this.child.stdin.on("error", (error) => this.fail(new Error(`Deno LSP input failed: ${error.message}`)));
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString()}`.slice(-MAX_STDERR_CHARS);
		});
		this.child.once("error", (error) => this.fail(new Error(`Deno LSP failed to start: ${error.message}`)));
		this.child.once("exit", (code, signal) => {
			if (!this.stopped) this.fail(new Error(`Deno LSP exited unexpectedly (code=${code}, signal=${signal})${this.stderr ? `\n${this.stderr}` : ""}`));
		});
		const abort = () => this.fail(abortError(options.signal));
		options.signal.addEventListener("abort", abort, { once: true });
		this.child.once("exit", () => options.signal.removeEventListener("abort", abort));
		if (options.signal.aborted) abort();
	}

	request(method: string, params?: unknown): Promise<unknown> {
		if (this.stopped) return Promise.reject(new Error("Deno LSP is not running"));
		const id = this.nextId++;
		const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			try {
				this.send(message);
			} catch (error) {
				this.pending.delete(id);
				reject(error);
			}
		});
	}

	notify(method: string, params?: unknown): void {
		if (this.stopped) return;
		this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
	}

	async shutdown(): Promise<void> {
		if (!this.stopped) {
			try {
				await this.request("shutdown");
				this.notify("exit");
			} catch {
				// Process termination below is the fallback.
			}
		}
		this.stopped = true;
		if (!this.child.stdin.destroyed) this.child.stdin.end();
		await waitForExit(this.child, SHUTDOWN_GRACE_MS);
		if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
		await waitForExit(this.child, SHUTDOWN_GRACE_MS);
		if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
		this.rejectPending(new Error("Deno LSP shut down"));
	}

	private send(message: JsonRpcMessage): void {
		const body = JSON.stringify(message);
		if (Buffer.byteLength(body) > MAX_MESSAGE_BYTES) throw new Error(`Deno LSP request exceeds ${MAX_MESSAGE_BYTES} bytes`);
		this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
	}

	private receive(chunk: Buffer): void {
		if (this.stopped) return;
		this.input = Buffer.concat([this.input, chunk]);
		try {
			while (this.readMessage()) {}
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private readMessage(): boolean {
		const headerEnd = this.input.indexOf("\r\n\r\n");
		if (headerEnd === -1) {
			if (this.input.length > MAX_HEADER_BYTES) throw new Error("Deno LSP returned an oversized header");
			return false;
		}
		if (headerEnd > MAX_HEADER_BYTES) throw new Error("Deno LSP returned an oversized header");
		const match = /^Content-Length:\s*(\d+)$/im.exec(this.input.subarray(0, headerEnd).toString());
		if (!match) throw new Error("Deno LSP returned a message without Content-Length");
		const length = Number(match[1]);
		if (!Number.isSafeInteger(length) || length < 0 || length > MAX_MESSAGE_BYTES) {
			throw new Error(`Deno LSP returned an invalid message length: ${match[1]}`);
		}
		const bodyStart = headerEnd + 4;
		if (this.input.length < bodyStart + length) return false;
		const body = this.input.subarray(bodyStart, bodyStart + length).toString();
		this.input = this.input.subarray(bodyStart + length);
		const message = JSON.parse(body) as unknown;
		if (!isRecord(message) || message["jsonrpc"] !== "2.0") throw new Error("Deno LSP returned invalid JSON-RPC");
		this.handle(message as JsonRpcMessage);
		return true;
	}

	private handle(message: JsonRpcMessage): void {
		if (typeof message.method === "string") {
			if (message.id !== undefined) this.answerServerRequest(message);
			return;
		}
		if (typeof message.id !== "number") return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (message.error !== undefined) pending.reject(new Error(`Deno LSP request failed: ${formatRpcError(message.error)}`));
		else pending.resolve(message.result);
	}

	private answerServerRequest(message: JsonRpcMessage): void {
		let result: unknown = null;
		if (message.method === "workspace/configuration") {
			const items = isRecord(message.params) && Array.isArray(message.params["items"])
				? message.params["items"]
				: [];
			result = items.map(() => ({ enable: true }));
		}
		this.send({ jsonrpc: "2.0", id: message.id, result });
	}

	private fail(error: Error): void {
		if (this.stopped) return;
		this.stopped = true;
		this.rejectPending(error);
		if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
}

function formatRpcError(value: unknown): string {
	if (!isRecord(value)) return String(value);
	return typeof value["message"] === "string" ? value["message"] : JSON.stringify(value);
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Deno LSP operation aborted");
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(done, timeoutMs);
		const exited = () => done();
		function done() {
			clearTimeout(timer);
			child.off("exit", exited);
			resolve();
		}
		child.once("exit", exited);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
