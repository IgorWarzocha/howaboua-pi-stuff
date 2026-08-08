import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Dealer, Subscriber } from "zeromq";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import { createJupyterConnectionFile, jupyterEndpoint, type JupyterConnectionInfo } from "./jupyter-connection.ts";
import {
	applyKernelOutput,
	finishKernelExecution,
	type ActiveKernelExecution,
	type KernelExecutionResult,
} from "./jupyter-output.ts";
import {
	createJupyterMessage,
	decodeJupyterMessage,
	encodeJupyterMessage,
	type JupyterMessage,
} from "./jupyter-wire.ts";

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const SUBSCRIBER_SETTLE_MS = 50;
const SHUTDOWN_GRACE_MS = 1_500;
const MAX_STDERR_CHARS = 16_384;
export type { KernelExecutionResult } from "./jupyter-output.ts";

interface ShellReplyWaiter {
	resolve(message: JupyterMessage): void;
	reject(error: Error): void;
	timer?: ReturnType<typeof setTimeout> | undefined;
}

export class DenoJupyterKernel {
	private readonly deno: string;
	private readonly cwd: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly maxHeapMiB: number;
	private readonly session = randomUUID();
	private process: ChildProcess | undefined;
	private tempDir: string | undefined;
	private connection: JupyterConnectionInfo | undefined;
	private shell: Dealer | undefined;
	private control: Dealer | undefined;
	private iopub: Subscriber | undefined;
	private startup: Promise<void> | undefined;
	private active: ActiveKernelExecution | undefined;
	private readonly shellReplies = new Map<string, ShellReplyWaiter>();
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
		const execution: ActiveKernelExecution = {
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
			const [result, reply] = await Promise.all([
				completion,
				this.sendShellRequest(message),
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
		const { info, path, dir } = await createJupyterConnectionFile();
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
		this.shell.connect(jupyterEndpoint(connection, connection.shell_port));
		this.control.connect(jupyterEndpoint(connection, connection.control_port));
		this.iopub.connect(jupyterEndpoint(connection, connection.iopub_port));
		this.iopub.subscribe("");
		void this.runShellPump(this.shell, connection);
		await sleep(SUBSCRIBER_SETTLE_MS, undefined, signal ? { signal } : undefined);
		void this.runIopubPump();
		await this.shellRequest("kernel_info_request", {}, STARTUP_TIMEOUT_MS);
	}

	private async shellRequest(
		type: string,
		content: Record<string, unknown>,
		timeoutMs = REQUEST_TIMEOUT_MS,
	): Promise<JupyterMessage> {
		const shell = this.shell;
		const connection = this.connection;
		if (!shell || !connection) throw new Error("Deno Jupyter shell is not connected");
		const request = createJupyterMessage(type, content, this.session);
		return this.sendShellRequest(request, timeoutMs, type);
	}

	private async sendShellRequest(
		request: JupyterMessage,
		timeoutMs?: number,
		requestType = "request",
	): Promise<JupyterMessage> {
		const shell = this.shell;
		const connection = this.connection;
		if (!shell || !connection) throw new Error("Deno Jupyter shell is not connected");
		const requestId = request.header.msg_id;
		if (this.shellReplies.has(requestId)) throw new Error(`Duplicate Deno Jupyter shell request: ${requestId}`);
		let waiter!: ShellReplyWaiter;
		const reply = new Promise<JupyterMessage>((resolve, reject) => {
			waiter = { resolve, reject };
		});
		if (timeoutMs !== undefined) {
			waiter.timer = setTimeout(() => {
				if (this.shellReplies.get(requestId) !== waiter) return;
				this.shellReplies.delete(requestId);
				waiter.reject(new Error(`Deno Jupyter did not answer ${requestType} within ${timeoutMs}ms${this.stderr ? `\n${this.stderr}` : ""}`));
			}, timeoutMs);
		}
		this.shellReplies.set(requestId, waiter);
		try {
			await shell.send(encodeJupyterMessage(request, connection.key));
			return await reply;
		} catch (error) {
			if (this.shellReplies.get(requestId) === waiter) this.shellReplies.delete(requestId);
			if (waiter.timer) clearTimeout(waiter.timer);
			throw error;
		}
	}

	private async runShellPump(socket: Dealer, connection: JupyterConnectionInfo): Promise<void> {
		try {
			for await (const frames of socket) {
				const message = decodeJupyterMessage([...frames] as Buffer[], connection.key);
				const requestId = message?.parent_header["msg_id"];
				if (typeof requestId !== "string") continue;
				const waiter = this.shellReplies.get(requestId);
				if (!waiter) continue;
				this.shellReplies.delete(requestId);
				if (waiter.timer) clearTimeout(waiter.timer);
				waiter.resolve(message!);
			}
		} catch (error) {
			if (this.shell === socket) this.failKernel(error instanceof Error ? error : new Error(String(error)));
		}
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
		if (applyKernelOutput(message, execution) === "idle") {
			this.active = undefined;
			execution.resolve(finishKernelExecution(execution));
		}
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
		const shell = this.shell;
		this.shell = undefined;
		for (const waiter of this.shellReplies.values()) {
			if (waiter.timer) clearTimeout(waiter.timer);
			waiter.reject(new Error("Deno Jupyter shell disconnected"));
		}
		this.shellReplies.clear();
		shell?.close();
		this.control?.close();
		this.iopub?.close();
		this.control = undefined;
		this.iopub = undefined;
		this.connection = undefined;
		this.startup = undefined;
		if (this.tempDir) rmSync(this.tempDir, { recursive: true, force: true });
		this.tempDir = undefined;
	}
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
