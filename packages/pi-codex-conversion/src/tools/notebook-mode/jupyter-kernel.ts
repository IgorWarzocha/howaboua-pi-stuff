import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Dealer, Subscriber } from "zeromq";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import {
	createJupyterMessage,
	decodeJupyterMessage,
	encodeJupyterMessage,
	type JupyterMessage,
} from "./jupyter-wire.ts";

const READY_TIMEOUT_MS = 8_000;
const SUBSCRIBER_SETTLE_MS = 50;
const SHUTDOWN_GRACE_MS = 1_500;
const MAX_STDERR_CHARS = 16_384;
const MAX_EXECUTION_OUTPUT_CHARS = 32 * 1024 * 1024;
const MAX_EXECUTION_OUTPUT_ITEMS = 10_000;

interface ConnectionInfo {
	ip: "127.0.0.1";
	transport: "tcp";
	shell_port: number;
	iopub_port: number;
	stdin_port: number;
	control_port: number;
	hb_port: number;
	signature_scheme: "hmac-sha256";
	key: string;
	kernel_name: "deno";
}

export interface KernelExecutionResult {
	status: "ok" | "error" | "aborted";
	items: RuntimeContentItem[];
	errorText?: string | undefined;
}

interface ActiveExecution {
	requestId: string;
	items: RuntimeContentItem[];
	outputChars: number;
	outputTruncated: boolean;
	status: KernelExecutionResult["status"];
	errorText?: string | undefined;
	onOutput?: ((item: RuntimeContentItem) => void) | undefined;
	resolve(result: KernelExecutionResult): void;
	reject(error: Error): void;
}

export class DenoJupyterKernel {
	private readonly deno: string;
	private readonly cwd: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly maxHeapMiB: number;
	private readonly session = randomUUID();
	private process: ChildProcess | undefined;
	private tempDir: string | undefined;
	private connection: ConnectionInfo | undefined;
	private shell: Dealer | undefined;
	private control: Dealer | undefined;
	private iopub: Subscriber | undefined;
	private startup: Promise<void> | undefined;
	private active: ActiveExecution | undefined;
	private stderr = "";

	constructor(options: { deno: string; cwd: string; maxHeapMiB: number; env?: NodeJS.ProcessEnv | undefined }) {
		this.deno = options.deno;
		this.cwd = options.cwd;
		this.env = options.env ?? process.env;
		this.maxHeapMiB = options.maxHeapMiB;
	}

	async start(signal?: AbortSignal): Promise<void> {
		if (!this.startup) this.startup = this.startInner(signal).catch((error) => {
			this.startup = undefined;
			this.dispose();
			throw error;
		});
		return this.startup;
	}

	async execute(
		code: string,
		options: { signal?: AbortSignal | undefined; onOutput?: ((item: RuntimeContentItem) => void) | undefined } = {},
	): Promise<KernelExecutionResult> {
		await this.start(options.signal);
		options.signal?.throwIfAborted();
		if (this.active) throw new Error("Notebook kernel already has an active cell");
		const connection = this.connection!;
		const shell = this.shell!;
		const message = createJupyterMessage("execute_request", {
			code,
			silent: false,
			store_history: true,
			user_expressions: {},
			allow_stdin: false,
			stop_on_error: true,
		}, this.session);
		let resolve!: (result: KernelExecutionResult) => void;
		let reject!: (error: Error) => void;
		const completion = new Promise<KernelExecutionResult>((done, fail) => {
			resolve = done;
			reject = fail;
		});
		const execution: ActiveExecution = {
			requestId: message.header.msg_id,
			items: [],
			outputChars: 0,
			outputTruncated: false,
			status: "ok",
			...(options.onOutput ? { onOutput: options.onOutput } : {}),
			resolve,
			reject,
		};
		const abort = () => void this.interrupt().catch(() => undefined);
		options.signal?.addEventListener("abort", abort, { once: true });
		this.active = execution;
		try {
			await shell.send(encodeJupyterMessage(message, connection.key));
			const [result, reply] = await Promise.all([
				completion,
				this.receiveShellReply(message.header.msg_id),
			]);
			if (reply.header.msg_type !== "execute_reply") {
				throw new Error(`Deno Jupyter returned ${reply.header.msg_type} for execute_request`);
			}
			return options.signal?.aborted ? { ...result, status: "aborted" } : result;
		} catch (error) {
			if (this.active === execution) this.active = undefined;
			throw error;
		} finally {
			options.signal?.removeEventListener("abort", abort);
		}
	}

	async complete(code = "", cursorPosition = code.length): Promise<string[]> {
		await this.start();
		if (this.active) throw new Error("Cannot request notebook completions while a cell is active");
		const response = await this.shellRequest("complete_request", {
			code,
			cursor_pos: cursorPosition,
		});
		const matches = response.content["matches"];
		return Array.isArray(matches)
			? matches.filter((value): value is string => typeof value === "string")
			: [];
	}

	async interrupt(): Promise<void> {
		if (!this.control || !this.connection) return;
		const message = createJupyterMessage("interrupt_request", {}, this.session);
		await this.control.send(encodeJupyterMessage(message, this.connection.key));
	}

	async shutdown(): Promise<void> {
		const process = this.process;
		if (this.control && this.connection) {
			try {
				const message = createJupyterMessage("shutdown_request", { restart: false }, this.session);
				await this.control.send(encodeJupyterMessage(message, this.connection.key));
			} catch {
				// Process termination below is the fallback.
			}
		}
		if (process?.exitCode === null && process.signalCode === null) {
			await waitForProcessExit(process, SHUTDOWN_GRACE_MS);
		}
		if (process?.exitCode === null && process.signalCode === null) {
			process.kill("SIGTERM");
			await waitForProcessExit(process, SHUTDOWN_GRACE_MS);
		}
		if (process?.exitCode === null && process.signalCode === null) {
			process.kill("SIGKILL");
			await waitForProcessExit(process, SHUTDOWN_GRACE_MS);
		}
		this.dispose();
	}

	private async startInner(signal?: AbortSignal): Promise<void> {
		if (this.process && this.connection) return;
		signal?.throwIfAborted();
		const { info, path, dir } = await createConnectionFile();
		this.tempDir = dir;
		const child = spawn(this.deno, ["jupyter", "--kernel", "--conn", path], {
			cwd: this.cwd,
			env: {
				...this.env,
				DENO_V8_FLAGS: [this.env["DENO_V8_FLAGS"], `--max-old-space-size=${this.maxHeapMiB}`]
					.filter(Boolean)
					.join(" "),
			},
			stdio: ["ignore", "ignore", "pipe"],
		});
		this.process = child;
		child.stderr?.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString()}`.slice(-MAX_STDERR_CHARS);
		});
		child.on("error", (error) => this.failKernel(new Error(`Deno Jupyter process failed: ${error.message}`)));
		child.on("exit", (code, childSignal) => {
			if (this.process !== child) return;
			this.failKernel(new Error(`Deno Jupyter exited unexpectedly (code=${code}, signal=${childSignal})${this.stderr ? `\n${this.stderr}` : ""}`));
		});
		const connection = info;
		this.connection = connection;
		this.shell = new Dealer();
		this.control = new Dealer();
		this.iopub = new Subscriber();
		this.shell.connect(endpoint(connection, connection.shell_port));
		this.control.connect(endpoint(connection, connection.control_port));
		this.iopub.connect(endpoint(connection, connection.iopub_port));
		this.iopub.subscribe("");
		await sleep(SUBSCRIBER_SETTLE_MS, undefined, signal ? { signal } : undefined);
		void this.runIopubPump();
		await this.shellRequest("kernel_info_request", {}, READY_TIMEOUT_MS);
	}

	private async shellRequest(
		type: string,
		content: Record<string, unknown>,
		timeoutMs = READY_TIMEOUT_MS,
	): Promise<JupyterMessage> {
		const shell = this.shell;
		const connection = this.connection;
		if (!shell || !connection) throw new Error("Deno Jupyter shell is not connected");
		const request = createJupyterMessage(type, content, this.session);
		await shell.send(encodeJupyterMessage(request, connection.key));
		return this.receiveShellReply(request.header.msg_id, timeoutMs, type);
	}

	private async receiveShellReply(
		requestId: string,
		timeoutMs?: number,
		requestType = "request",
	): Promise<JupyterMessage> {
		const shell = this.shell;
		const connection = this.connection;
		if (!shell || !connection) throw new Error("Deno Jupyter shell is not connected");
		if (timeoutMs === undefined) {
			while (true) {
				const message = decodeJupyterMessage([...await shell.receive()] as Buffer[], connection.key);
				if (message?.parent_header["msg_id"] === requestId) return message;
			}
		}
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const remaining = Math.max(1, deadline - Date.now());
			const result = await Promise.race([
				shell.receive().then((frames) => ({ kind: "frames" as const, frames })),
				sleep(remaining).then(() => ({ kind: "timeout" as const })),
			]);
			if (result.kind === "timeout") break;
			const message = decodeJupyterMessage([...result.frames] as Buffer[], connection.key);
			if (message?.parent_header["msg_id"] === requestId) return message;
		}
		throw new Error(`Deno Jupyter did not answer ${requestType} within ${timeoutMs}ms${this.stderr ? `\n${this.stderr}` : ""}`);
	}

	private async runIopubPump(): Promise<void> {
		const socket = this.iopub;
		const connection = this.connection;
		if (!socket || !connection) return;
		try {
			for await (const frames of socket) {
				const message = decodeJupyterMessage([...frames] as Buffer[], connection.key);
				if (message) this.handleIopub(message);
			}
		} catch (error) {
			if (this.iopub === socket) this.failKernel(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private handleIopub(message: JupyterMessage): void {
		const execution = this.active;
		if (!execution || message.parent_header["msg_id"] !== execution.requestId) return;
		const type = message.header.msg_type;
		if (type === "stream") {
			const text = message.content["text"];
			if (typeof text === "string" && text) this.emit(execution, { type: "input_text", text });
			return;
		}
		if (type === "execute_result" || type === "display_data") {
			const data = message.content["data"];
			if (!data || typeof data !== "object" || Array.isArray(data)) return;
			const bundle = data as Record<string, unknown>;
			for (const mime of ["image/png", "image/jpeg", "image/gif"] as const) {
				const encoded = bundle[mime];
				if (typeof encoded === "string") {
					this.emit(execution, { type: "input_image", image_url: `data:${mime};base64,${encoded}` });
					return;
				}
			}
			const text = bundle["text/markdown"] ?? bundle["text/plain"];
			if (typeof text === "string" && text !== "undefined") this.emit(execution, { type: "input_text", text });
			return;
		}
		if (type === "error") {
			const name = typeof message.content["ename"] === "string" ? message.content["ename"] : "Error";
			const value = typeof message.content["evalue"] === "string" ? message.content["evalue"] : "Notebook cell failed";
			const traceback = Array.isArray(message.content["traceback"])
				? message.content["traceback"].filter((line): line is string => typeof line === "string")
				: [];
			execution.status = "error";
			execution.errorText = traceback.length > 0 ? traceback.join("\n") : `${name}: ${value}`;
			return;
		}
		if (type === "status" && message.content["execution_state"] === "idle") {
			this.active = undefined;
			execution.resolve({
				status: execution.status,
				items: execution.items,
				...(execution.errorText ? { errorText: execution.errorText } : {}),
			});
		}
	}

	private emit(execution: ActiveExecution, item: RuntimeContentItem): void {
		if (execution.outputTruncated) return;
		const size = item.type === "input_text" ? item.text?.length ?? 0 : item.image_url?.length ?? 0;
		if (execution.items.length >= MAX_EXECUTION_OUTPUT_ITEMS || execution.outputChars + size > MAX_EXECUTION_OUTPUT_CHARS) {
			item = { type: "input_text", text: "[Notebook cell output truncated]" };
			execution.outputTruncated = true;
		}
		execution.items.push(item);
		execution.outputChars += item.type === "input_text" ? item.text?.length ?? 0 : item.image_url?.length ?? 0;
		execution.onOutput?.(item);
	}

	private failKernel(error: Error): void {
		const active = this.active;
		this.active = undefined;
		active?.reject(error);
		this.dispose();
	}

	private dispose(): void {
		const child = this.process;
		this.process = undefined;
		if (child?.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			const killTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, SHUTDOWN_GRACE_MS);
			killTimer.unref?.();
			child.once("exit", () => clearTimeout(killTimer));
		}
		this.shell?.close();
		this.control?.close();
		this.iopub?.close();
		this.shell = undefined;
		this.control = undefined;
		this.iopub = undefined;
		this.connection = undefined;
		this.startup = undefined;
		if (this.tempDir) rmSync(this.tempDir, { recursive: true, force: true });
		this.tempDir = undefined;
	}
}

async function createConnectionFile(): Promise<{ info: ConnectionInfo; path: string; dir: string }> {
	const [shellPort, iopubPort, stdinPort, controlPort, heartbeatPort] = await reserveLoopbackPorts(5);
	const info: ConnectionInfo = {
		ip: "127.0.0.1",
		transport: "tcp",
		shell_port: shellPort!,
		iopub_port: iopubPort!,
		stdin_port: stdinPort!,
		control_port: controlPort!,
		hb_port: heartbeatPort!,
		signature_scheme: "hmac-sha256",
		key: randomBytes(24).toString("hex"),
		kernel_name: "deno",
	};
	const dir = mkdtempSync(join(tmpdir(), "pi-codex-deno-kernel-"));
	const path = join(dir, "connection.json");
	writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
	return { info, path, dir };
}

async function reserveLoopbackPorts(count: number): Promise<number[]> {
	const servers: Server[] = [];
	try {
		for (let index = 0; index < count; index += 1) {
			const server = createServer();
			servers.push(server);
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", () => {
					server.off("error", reject);
					resolve();
				});
			});
		}
		return servers.map((server) => {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Could not reserve a Jupyter loopback port");
			return address.port;
		});
	} finally {
		await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
	}
}

function endpoint(connection: ConnectionInfo, port: number): string {
	return `${connection.transport}://${connection.ip}:${port}`;
}

function waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<void> {
	if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(finish, timeoutMs);
		const exited = () => finish();
		function finish() {
			clearTimeout(timer);
			process.off("exit", exited);
			resolve();
		}
		process.once("exit", exited);
	});
}
