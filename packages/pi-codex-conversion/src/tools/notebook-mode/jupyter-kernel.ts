import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Dealer, Subscriber } from "zeromq";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import { createJupyterConnectionFile, jupyterEndpoint, type JupyterConnectionInfo } from "./jupyter-connection.ts";
import {
	applyExecuteReplyError,
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
const SEND_TIMEOUT_MS = 5_000;
const SHUTDOWN_GRACE_MS = 1_500;
const MAX_STDERR_CHARS = 16_384;
const MAX_JUPYTER_MESSAGE_BYTES = 40 * 1024 * 1024;
export type { KernelExecutionResult } from "./jupyter-output.ts";

interface ShellReplyWaiter {
	resolve(message: JupyterMessage): void;
	reject(error: Error): void;
	timer?: ReturnType<typeof setTimeout> | undefined;
	abort?: (() => void) | undefined;
}

export class DenoJupyterKernel {
	private readonly deno: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly maxHeapMiB: number;
	private readonly onFailure: ((kernel: DenoJupyterKernel, error: Error) => void) | undefined;
	private readonly session = randomUUID();
	private process: ChildProcess | undefined;
	private tempDir: string | undefined;
	private connection: JupyterConnectionInfo | undefined;
	private shell: Dealer | undefined;
	private control: Dealer | undefined;
	private iopub: Subscriber | undefined;
	private shellPump: Promise<void> | undefined;
	private iopubPump: Promise<void> | undefined;
	private startup: Promise<void> | undefined;
	private active: ActiveKernelExecution | undefined;
	private readonly shellReplies = new Map<string, ShellReplyWaiter>();
	private stderr = "";
	private terminalFailure: Error | undefined;

	constructor(options: {
		deno: string;
		maxHeapMiB: number;
		env?: NodeJS.ProcessEnv | undefined;
		onFailure?: ((kernel: DenoJupyterKernel, error: Error) => void) | undefined;
	}) {
		this.deno = options.deno;
		this.env = options.env ?? process.env;
		this.maxHeapMiB = options.maxHeapMiB;
		this.onFailure = options.onFailure;
	}

	async start(signal?: AbortSignal): Promise<void> {
		if (this.terminalFailure) {
			throw new Error(`Deno Jupyter kernel is unavailable: ${this.terminalFailure.message}`, { cause: this.terminalFailure });
		}
		if (!this.startup) this.startup = this.startInner(signal).catch((error) => {
			this.startup = undefined;
			this.dispose();
			throw error;
		});
		return this.startup;
	}

	async execute(
		code: string,
		options: {
			signal?: AbortSignal | undefined;
			onOutput?: ((item: RuntimeContentItem) => void) | undefined;
			interruptOnAbort?: boolean | undefined;
		} = {},
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
		let abortTimer: ReturnType<typeof setTimeout> | undefined;
		let finished = false;
		const abort = () => {
			if (options.interruptOnAbort !== false) void this.interrupt().catch(() => undefined);
			abortTimer = setTimeout(() => {
				if (!finished) {
					this.failKernel(options.signal?.reason instanceof Error
						? options.signal.reason
						: new Error("Deno Jupyter execution did not stop after cancellation"));
				}
			}, SHUTDOWN_GRACE_MS);
			abortTimer.unref?.();
		};
		options.signal?.addEventListener("abort", abort, { once: true });
		this.active = execution;
		try {
			const completionState = completion.then((result) => ({ kind: "completion" as const, result }));
			const replyState = this.sendShellRequest(message, undefined, "execute_request")
				.then((reply) => ({ kind: "reply" as const, reply }));
			let result: KernelExecutionResult;
			let reply: JupyterMessage;
			try {
				const first = await Promise.race([completionState, replyState]);
				if (first.kind === "completion") {
					result = first.result;
					reply = (await withTimeout(
						replyState,
						REQUEST_TIMEOUT_MS,
						() => new Error(`Deno Jupyter did not answer execute_request after the cell became idle within ${REQUEST_TIMEOUT_MS}ms`),
					)).reply;
				} else {
					reply = first.reply;
					result = (await withTimeout(
						completionState,
						REQUEST_TIMEOUT_MS,
						() => new Error(`Deno Jupyter did not become idle after execute_reply within ${REQUEST_TIMEOUT_MS}ms`),
					)).result;
				}
			} catch (error) {
				this.failKernel(error instanceof Error ? error : new Error(String(error)));
				throw error;
			}
			if (reply.header.msg_type !== "execute_reply") {
				throw new Error(`Deno Jupyter returned ${reply.header.msg_type} for execute_request`);
			}
			const replied = applyExecuteReplyError(result, reply);
			if (options.signal?.aborted) {
				if (options.interruptOnAbort !== false) this.failKernel(new Error("Deno Jupyter execution was aborted"));
				return { ...replied, status: "aborted" };
			}
			return replied;
		} catch (error) {
			if (this.active === execution) this.active = undefined;
			throw error;
		} finally {
			finished = true;
			if (abortTimer) clearTimeout(abortTimer);
			options.signal?.removeEventListener("abort", abort);
		}
	}

	async complete(code = "", cursorPosition = code.length, signal?: AbortSignal): Promise<string[]> {
		await this.start(signal);
		signal?.throwIfAborted();
		if (this.active) throw new Error("Cannot request notebook completions while a cell is active");
		const response = await this.shellRequest("complete_request", {
			code,
			cursor_pos: cursorPosition,
		}, REQUEST_TIMEOUT_MS, signal);
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
		const pumps = [this.shellPump, this.iopubPump].filter((pump): pump is Promise<void> => Boolean(pump));
		if (this.control && this.connection) {
			try {
				const message = createJupyterMessage("shutdown_request", { restart: false }, this.session);
				await withTimeout(
					this.control.send(encodeJupyterMessage(message, this.connection.key)),
					SHUTDOWN_GRACE_MS,
					() => new Error(`Deno Jupyter could not send shutdown_request within ${SHUTDOWN_GRACE_MS}ms`),
				);
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
		await withTimeout(
			Promise.allSettled(pumps),
			SHUTDOWN_GRACE_MS,
			() => new Error(`Deno Jupyter socket pumps did not stop within ${SHUTDOWN_GRACE_MS}ms`),
		).catch(() => undefined);
		this.shellPump = undefined;
		this.iopubPump = undefined;
	}

	private async startInner(signal?: AbortSignal): Promise<void> {
		if (this.process && this.connection) return;
		signal?.throwIfAborted();
		const { info, path, dir } = await createJupyterConnectionFile();
		this.tempDir = dir;
		const child = spawn(this.deno, ["jupyter", "--kernel", "--conn", path], {
			cwd: dir,
			env: {
				...this.env,
				DENO_NO_PACKAGE_JSON: "1",
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
		this.shell.maxMessageSize = MAX_JUPYTER_MESSAGE_BYTES;
		this.control.maxMessageSize = MAX_JUPYTER_MESSAGE_BYTES;
		this.iopub.maxMessageSize = MAX_JUPYTER_MESSAGE_BYTES;
		this.shell.sendTimeout = SEND_TIMEOUT_MS;
		this.control.sendTimeout = SEND_TIMEOUT_MS;
		this.shell.linger = 0;
		this.control.linger = 0;
		this.iopub.linger = 0;
		this.shell.connect(jupyterEndpoint(connection, connection.shell_port));
		this.control.connect(jupyterEndpoint(connection, connection.control_port));
		this.iopub.connect(jupyterEndpoint(connection, connection.iopub_port));
		this.iopub.subscribe("");
		this.shellPump = this.runShellPump(this.shell, connection);
		let markIopubReady!: () => void;
		const iopubReady = new Promise<void>((resolve) => { markIopubReady = resolve; });
		this.iopubPump = this.runIopubPump(markIopubReady);
		await this.waitForKernelReady(iopubReady, signal);
	}

	private async waitForKernelReady(iopubReady: Promise<void>, signal?: AbortSignal): Promise<void> {
		const deadline = Date.now() + STARTUP_TIMEOUT_MS;
		while (true) {
			signal?.throwIfAborted();
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				throw new Error(`Deno Jupyter IOPub did not become ready within ${STARTUP_TIMEOUT_MS}ms${this.stderr ? `\n${this.stderr}` : ""}`);
			}
			await this.shellRequest("kernel_info_request", {}, remaining, signal);
			const ready = await Promise.race([
				iopubReady.then(() => true),
				sleep(Math.min(100, remaining), false, signal ? { signal } : undefined),
			]);
			if (ready) return;
		}
	}

	private async shellRequest(
		type: string,
		content: Record<string, unknown>,
		timeoutMs = REQUEST_TIMEOUT_MS,
		signal?: AbortSignal,
	): Promise<JupyterMessage> {
		const shell = this.shell;
		const connection = this.connection;
		if (!shell || !connection) throw new Error("Deno Jupyter shell is not connected");
		const request = createJupyterMessage(type, content, this.session);
		return this.sendShellRequest(request, timeoutMs, type, signal);
	}

	private async sendShellRequest(
		request: JupyterMessage,
		timeoutMs?: number,
		requestType = "request",
		signal?: AbortSignal,
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
		if (signal) {
			waiter.abort = () => {
				if (this.shellReplies.get(requestId) !== waiter) return;
				this.shellReplies.delete(requestId);
				if (waiter.timer) clearTimeout(waiter.timer);
				waiter.reject(signal.reason instanceof Error ? signal.reason : new Error("Deno Jupyter request aborted"));
			};
			signal.addEventListener("abort", waiter.abort, { once: true });
		}
		this.shellReplies.set(requestId, waiter);
		try {
			signal?.throwIfAborted();
			await shell.send(encodeJupyterMessage(request, connection.key));
			return await reply;
		} catch (error) {
			if (this.shellReplies.get(requestId) === waiter) this.shellReplies.delete(requestId);
			if (waiter.timer) clearTimeout(waiter.timer);
			throw error;
		} finally {
			if (waiter.abort) signal?.removeEventListener("abort", waiter.abort);
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

	private async runIopubPump(markReady?: () => void): Promise<void> {
		const socket = this.iopub;
		const connection = this.connection;
		if (!socket || !connection) return;
		try {
			for await (const frames of socket) {
				const message = decodeJupyterMessage([...frames] as Buffer[], connection.key);
				if (message) {
					markReady?.();
					markReady = undefined;
					this.handleIopub(message);
				}
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
		if (!this.terminalFailure) {
			this.terminalFailure = error;
			this.onFailure?.(this, error);
		}
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

async function withTimeout<T>(pending: Promise<T>, timeoutMs: number, timeoutError: () => Error): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(timeoutError()), timeoutMs);
		timer.unref?.();
	});
	try {
		return await Promise.race([pending, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
