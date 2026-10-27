import { randomUUID } from "node:crypto";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import { diagnoseDenoSyntax } from "./deno-syntax-diagnostics.ts";
import { withNotebookRecoveryGuidance } from "./runtime-health.ts";
import { applyExecuteReplyError, applyKernelOutput, finishKernelExecution, OUTPUT_DRAIN_MESSAGE, type ActiveKernelExecution, type KernelExecutionResult } from "./jupyter-output.ts";
import { createJupyterMessage, type JupyterMessage } from "./jupyter-wire.ts";
import { JupyterKernelConnection } from "./jupyter/connection.ts";
import { withJupyterTimeout as withTimeout } from "./jupyter/shell-channel.ts";

const REQUEST_TIMEOUT_MS = 8_000;
const SHUTDOWN_GRACE_MS = 1_500;
export type { KernelExecutionResult } from "./jupyter-output.ts";

export class DenoJupyterKernel {
	private readonly deno: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly onFailure: ((kernel: DenoJupyterKernel, error: Error) => void) | undefined;
	private readonly session = randomUUID();
	private readonly connection: JupyterKernelConnection;
	private active: ActiveKernelExecution | undefined;
	private terminalFailure: Error | undefined;

	constructor(options: {
		deno: string;
		maxHeapMiB: number;
		env?: NodeJS.ProcessEnv | undefined;
		onFailure?: ((kernel: DenoJupyterKernel, error: Error) => void) | undefined;
	}) {
		this.deno = options.deno;
		this.env = options.env ?? process.env;
		this.onFailure = options.onFailure;
		this.connection = new JupyterKernelConnection({
			deno: this.deno, env: this.env, maxHeapMiB: options.maxHeapMiB, session: this.session,
			onFailure: (error) => this.failKernel(error),
			onOutput: (message) => this.handleIopub(message),
		});
	}

	async start(signal?: AbortSignal): Promise<void> {
		if (this.terminalFailure) {
			throw new Error(withNotebookRecoveryGuidance("Notebook runtime is unavailable"), { cause: this.terminalFailure });
		}
		return this.connection.start(signal);
	}

	async execute(
		code: string,
		options: {
			cellSource?: string | undefined;
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
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const completion = new Promise<void>((done, fail) => {
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
			const completionState = completion.then(() => ({ kind: "completion" as const }));
			const replyState = this.connection.sendShellRequest(message, undefined, "execute_request")
				.then((reply) => ({ kind: "reply" as const, reply }));
			let reply: JupyterMessage;
			try {
				const first = await Promise.race([completionState, replyState]);
				if (first.kind === "completion") {
					reply = (await withTimeout(
						replyState,
						REQUEST_TIMEOUT_MS,
						() => new Error(`Deno Jupyter did not answer execute_request after the cell became idle within ${REQUEST_TIMEOUT_MS}ms`),
					)).reply;
				} else {
					reply = first.reply;
					await withTimeout(
						completionState,
						REQUEST_TIMEOUT_MS,
						() => new Error(withNotebookRecoveryGuidance(`Notebook execution did not finish within ${REQUEST_TIMEOUT_MS}ms`)),
					);
				}
			} catch (error) {
				this.failKernel(error instanceof Error ? error : new Error(String(error)));
				throw error;
			}
			if (reply.header.msg_type !== "execute_reply") {
				throw new Error(withNotebookRecoveryGuidance("Notebook execution returned an unexpected response"));
			}
			await this.drainOutput(execution);
			const replied = applyExecuteReplyError(finishKernelExecution(execution), reply);
			if (options.signal?.aborted) {
				if (options.interruptOnAbort !== false) this.failKernel(new Error("Deno Jupyter execution was aborted"));
				return { ...replied, status: "aborted" };
			}
			if (
				replied.errorName === "Error" &&
				replied.errorValue === "Execution failed" &&
				replied.errorText === "Error: Execution failed"
			) {
				const diagnostic = await diagnoseDenoSyntax(this.deno, code, this.env, options.cellSource);
				if (diagnostic) {
					return {
						...replied,
						errorName: "SyntaxError",
						errorValue: diagnostic.split("\n")[0]!.replace(/^SyntaxError:\s*/, ""),
						errorText: diagnostic,
					};
				}
			}
			return replied;
		} finally {
			finished = true;
			if (this.active === execution) this.active = undefined;
			if (abortTimer) clearTimeout(abortTimer);
			options.signal?.removeEventListener("abort", abort);
		}
	}

	async complete(code = "", cursorPosition = code.length, signal?: AbortSignal): Promise<string[]> {
		await this.start(signal);
		signal?.throwIfAborted();
		if (this.active) throw new Error("Cannot request notebook completions while a cell is active");
		const response = await this.connection.shellRequest("complete_request", {
			code,
			cursor_pos: cursorPosition,
		}, REQUEST_TIMEOUT_MS, signal);
		const matches = response.content["matches"];
		return Array.isArray(matches)
			? matches.filter((value): value is string => typeof value === "string")
			: [];
	}

	interrupt(): Promise<void> { return this.connection.interrupt(); }
	shutdown(): Promise<void> { return this.connection.shutdown(); }

	private handleIopub(message: JupyterMessage): void {
		const execution = this.active;
		if (!execution || (message.parent_header["msg_id"] !== execution.requestId
			&& message.parent_header["msg_id"] !== execution.drain?.requestId)) return;
		if (applyKernelOutput(message, execution) === "idle") {
			execution.resolve();
		}
	}

	private async drainOutput(execution: ActiveKernelExecution): Promise<void> {
		const marker = randomUUID();
		const message = createJupyterMessage("execute_request", {
			code: `globalThis.Deno.jupyter.broadcast(${JSON.stringify(OUTPUT_DRAIN_MESSAGE)}, { marker: ${JSON.stringify(marker)} });`,
			silent: true,
			store_history: false,
			user_expressions: {},
			allow_stdin: false,
			stop_on_error: true,
		}, this.session);
		// Deno 2.9.7 publishes idle before its FIFO output drainer finishes and
		// can reattribute queued output. Keep both parent IDs through the marker
		// and drain idle, without rewriting user source or adding history.
		execution.drain = { requestId: message.header.msg_id, marker, idle: false, seen: false };
		const completion = new Promise<void>((resolve, reject) => {
			execution.resolve = resolve;
			execution.reject = reject;
		});
		const timeoutError = new Error("Notebook output collection timed out");
		try {
			await withTimeout(
				Promise.all([
					this.connection.sendShellRequest(message, REQUEST_TIMEOUT_MS, "output drain").then((reply) => {
						if (reply.header.msg_type !== "execute_reply" || reply.content["status"] !== "ok") {
							throw new Error("Unexpected output drain reply");
						}
					}),
					completion,
				]),
				REQUEST_TIMEOUT_MS,
				() => timeoutError,
			);
		} catch (error) {
			const failure = new Error(withNotebookRecoveryGuidance(
				`Notebook output collection ${error === timeoutError ? "timed out" : "failed"}; the runtime is unavailable`,
			), { cause: error });
			this.failKernel(failure);
			throw failure;
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
		this.connection.dispose();
	}

}
