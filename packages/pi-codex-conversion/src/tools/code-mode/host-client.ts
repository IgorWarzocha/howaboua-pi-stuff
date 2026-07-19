import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "./types.js";
import { CodeModeDelegateRuntime } from "./delegate-runtime.js";
import {
	executionCellId,
	type HostMessage,
	isMissingRuntimeOutcome,
	parseHostMessage,
	parseExecSource,
	parseRuntimeResponse,
	runtimeOutcome,
	toWireToolDefinition,
} from "./host-protocol.js";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_QUEUED_WRITE_BYTES = 128 * 1024 * 1024;
const DEFAULT_SHUTDOWN_GRACE_MS = 250;

type Pending = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	context?: ToolExecutionContext | undefined;
	tools?: Map<string, CodeModeToolDefinition> | undefined;
};

type HostClientOptions = {
	binary: string;
	tools: CodeModeToolDefinition[];
	shutdownGraceMs?: number | undefined;
};

export class CodeModeHostClient {
	private readonly binary: string;
	private readonly tools: Map<string, CodeModeToolDefinition>;
	private readonly shutdownGraceMs: number;
	private readonly sessionId = randomUUID();
	private child: ChildProcessWithoutNullStreams | undefined;
	private buffer = Buffer.alloc(0);
	private requestId = 0;
	private ready: Promise<void> | undefined;
	private pending = new Map<number, Pending>();
	private initial = new Map<number, Pending>();
	private readonly delegateRuntime = new CodeModeDelegateRuntime((message) =>
		this.send(message),
	);
	private stderr = "";
	private queuedWriteBytes = 0;

	constructor(options: HostClientOptions) {
		this.binary = options.binary;
		this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
		this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
	}

	async start(): Promise<void> {
		if (this.ready) return this.ready;
		const ready = this.startProcess();
		this.ready = ready;
		try {
			await ready;
		} catch (error) {
			this.failAll(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	private async startProcess(): Promise<void> {
		const child = spawn(this.binary, [], {
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
		});
		this.child = child;
		this.buffer = Buffer.alloc(0);
		this.stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			if (this.child === child) this.onData(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (this.child === child)
				this.stderr = (this.stderr + chunk.toString()).slice(-16_384);
		});
		child.on("error", (error) => {
			if (this.child === child) this.failAll(error);
		});
		child.on("close", (code) => {
			if (this.child === child)
				this.failAll(
					new Error(
						`Code-mode host exited with code ${code ?? "unknown"}${this.stderr.trim() ? `: ${this.stderr.trim()}` : ""}`,
					),
				);
		});
		const handshake = new Promise<void>((resolve, reject) => {
			this.pending.set(0, { resolve: () => resolve(), reject });
		});
		this.send({
			type: "connection/hello",
			supportedVersions: [1],
			requiredCapabilities: [],
			optionalCapabilities: [],
		});
		await handshake;
		await this.request({ method: "session/open", sessionId: this.sessionId });
	}

	async execute(
		source: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
		tools: CodeModeToolDefinition[] = [...this.tools.values()],
	): Promise<RuntimeResponse> {
		throwIfAborted(signal);
		await this.start();
		throwIfAborted(signal);
		const { code, yieldTimeMs, maxOutputTokens } = parseExecSource(source);
		const effectiveYieldTimeMs = customToolYieldTime(code, tools) ?? yieldTimeMs;
		const id = ++this.requestId;
		const initial = new Promise<unknown>((resolve, reject) =>
			this.initial.set(id, { resolve, reject }),
		);
		void initial.catch(() => undefined);
		const toolSet = new Map(tools.map((tool) => [tool.name, tool]));
		const started = this.requestWithId(
			id,
			{
				method: "session/execute",
				sessionId: this.sessionId,
				request: {
					tool_call_id: `exec-${id}`,
					enabled_tools: tools.map(toWireToolDefinition),
					source: code,
					yield_time_ms: effectiveYieldTimeMs,
					max_output_tokens: maxOutputTokens,
				},
			},
			context,
			toolSet,
		);
		let cellId: string | undefined;
		const abort = () => {
			const error = abortError();
			try {
				this.send({ type: "operation/cancel", id });
			} catch {
				// Host teardown is already authoritative.
			}
			this.rejectOperation(id, error);
			if (cellId)
				void this.terminate(cellId, context).catch(() => undefined);
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const startedValue = await started;
			cellId = executionCellId(startedValue);
			if (signal?.aborted) {
				abort();
				throw abortError();
			}
			return {
				...this.delegateRuntime.attach(parseRuntimeResponse(await initial)),
				maxOutputTokens: maxOutputTokens ?? 10_000,
			};
		} catch (error) {
			this.initial.delete(id);
			throw error;
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	async wait(
		cellId: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		throwIfAborted(signal);
		await this.start();
		throwIfAborted(signal);
		this.delegateRuntime.updateCellContext(cellId, context);
		const id = ++this.requestId;
		const abort = () => {
			const error = abortError();
			try {
				this.send({ type: "operation/cancel", id });
			} catch {
				// Host teardown is already authoritative.
			}
			this.rejectOperation(id, error);
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const value = await this.requestWithId(
				id,
				{
					method: "session/wait",
					sessionId: this.sessionId,
					request: { cell_id: cellId, yield_time_ms: yieldTimeMs },
				},
				context,
			);
			const wrapped = runtimeOutcome(value);
			if (!wrapped)
				throw new Error("Code-mode host returned an invalid wait outcome");
			return {
				...this.delegateRuntime.attach(parseRuntimeResponse(wrapped)),
				...(isMissingRuntimeOutcome(value) ? { missingCell: true as const } : {}),
			};
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	async terminate(
		cellId: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		throwIfAborted(signal);
		await this.start();
		throwIfAborted(signal);
		this.delegateRuntime.updateCellContext(cellId, context);
		const id = ++this.requestId;
		const abort = () => {
			const error = abortError();
			try {
				this.send({ type: "operation/cancel", id });
			} catch {
				// Host teardown is already authoritative.
			}
			this.rejectOperation(id, error);
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const value = await this.requestWithId(
				id,
				{
					method: "session/terminate",
					sessionId: this.sessionId,
					cellId,
				},
				context,
			);
			const wrapped = runtimeOutcome(value);
			if (!wrapped)
				throw new Error("Code-mode host returned an invalid termination outcome");
			return {
				...this.delegateRuntime.attach(parseRuntimeResponse(wrapped)),
				...(isMissingRuntimeOutcome(value) ? { missingCell: true as const } : {}),
			};
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	async shutdown(): Promise<void> {
		const child = this.child;
		if (!child) return;
		try {
			await Promise.race([
				this.request({
					method: "session/shutdown",
					sessionId: this.sessionId,
				}),
				shutdownDeadline(this.shutdownGraceMs),
			]);
		} catch {
			// Process teardown below is authoritative.
		}
		child.kill();
		this.failAll(new Error("Code-mode host shut down"));
		this.delegateRuntime.clear();
		this.child = undefined;
		this.ready = undefined;
	}

	private request(
		request: Record<string, unknown>,
		context?: ToolExecutionContext,
	): Promise<unknown> {
		return this.requestWithId(++this.requestId, request, context);
	}

	private requestWithId(
		id: number,
		request: Record<string, unknown>,
		context?: ToolExecutionContext,
		tools?: Map<string, CodeModeToolDefinition>,
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, context, tools });
			try {
				this.send({ type: "operation/request", id, request });
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private rejectOperation(id: number, error: Error): void {
		const pending = this.pending.get(id);
		this.pending.delete(id);
		pending?.reject(error);
		const initial = this.initial.get(id);
		this.initial.delete(id);
		initial?.reject(error);
	}

	private send(message: unknown): void {
		const child = this.child;
		if (!child?.stdin.writable)
			throw new Error("Code-mode host is not running");
		const payload = Buffer.from(JSON.stringify(message));
		if (payload.length > MAX_FRAME_BYTES)
			throw new Error(`Code-mode frame exceeds ${MAX_FRAME_BYTES} bytes`);
		const header = Buffer.allocUnsafe(4);
		header.writeUInt32LE(payload.length);
		const frame = Buffer.concat([header, payload]);
		if (this.queuedWriteBytes + frame.length > MAX_QUEUED_WRITE_BYTES)
			throw new Error(
				`Code-mode write queue exceeds ${MAX_QUEUED_WRITE_BYTES} bytes`,
			);
		this.queuedWriteBytes += frame.length;
		child.stdin.write(frame, (error) => {
			this.queuedWriteBytes = Math.max(0, this.queuedWriteBytes - frame.length);
			if (error && this.child === child) this.failAll(error);
		});
	}

	private onData(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (this.buffer.length >= 4) {
			const length = this.buffer.readUInt32LE(0);
			if (length > MAX_FRAME_BYTES)
				return this.failAll(
					new Error(`Code-mode frame exceeds ${MAX_FRAME_BYTES} bytes`),
				);
			if (this.buffer.length < length + 4) return;
			const payload = this.buffer.subarray(4, length + 4);
			this.buffer = this.buffer.subarray(length + 4);
			try {
				this.handleMessage(parseHostMessage(JSON.parse(payload.toString("utf8"))));
			} catch (error) {
				this.failAll(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}

	private handleMessage(message: HostMessage): void {
		if (message.type === "connection/ready") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.resolve(undefined);
			return;
		}
		if (message.type === "connection/rejected") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.reject(
				new Error(
					`Code-mode handshake rejected: ${JSON.stringify(message.reason)}`,
				),
			);
			return;
		}
		if (message.type === "operation/response") {
			const pending = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (!pending) return;
			if (message.result.status === "error")
				return pending.reject(new Error(message.result.message));
			const value = message.result.value;
			const cellId = executionCellId(value);
			if (cellId && pending.context) {
				this.delegateRuntime.bindCell(cellId, pending.context, pending.tools);
			}
			pending.resolve(value);
			return;
		}
		if (message.type === "execute/initialResponse") {
			const pending = this.initial.get(message.id);
			this.initial.delete(message.id);
			if (!pending) return;
			if (message.result.status === "error")
				pending.reject(new Error(message.result.message));
			else pending.resolve(message.result.value);
			return;
		}
		if (message.type === "delegate/request") {
			this.delegateRuntime.handleRequest(message);
			return;
		}
		if (message.type === "delegate/cancel") {
			this.delegateRuntime.cancel(message.id);
			return;
		}
		if (message.type === "cell/closed")
			this.delegateRuntime.closeCell(message.cellId);
	}

	private failAll(error: Error): void {
		for (const pending of [...this.pending.values(), ...this.initial.values()])
			pending.reject(error);
		this.pending.clear();
		this.initial.clear();
		this.delegateRuntime.clear();
		this.queuedWriteBytes = 0;
		const child = this.child;
		this.child = undefined;
		this.ready = undefined;
		if (child && !child.killed) child.kill();
	}

}

function customToolYieldTime(
	code: string,
	tools: CodeModeToolDefinition[],
): number | null {
	const executableCode = maskJavaScriptCommentsAndStrings(code);
	let forced: number | undefined;
	for (const tool of tools) {
		if (!("command" in tool) || tool.yieldTimeMs === undefined) continue;
		const name = escapeRegExp(tool.name);
		const directReference = new RegExp(
			`\\btools\\s*\\.\\s*${name}(?![a-zA-Z0-9_$])\\s*\\(`,
		);
		if (!directReference.test(executableCode)) continue;
		forced = forced === undefined ? tool.yieldTimeMs : Math.max(forced, tool.yieldTimeMs);
	}
	return forced ?? null;
}

function maskJavaScriptCommentsAndStrings(code: string): string {
	const output = code.split("");
	let state:
		| "code"
		| "line-comment"
		| "block-comment"
		| "string"
		| "regex"
		| "template" = "code";
	let quote = "";
	let regexClass = false;
	let templateExpressionDepth: number | undefined;
	const templateReturnDepths: Array<number | undefined> = [];
	for (let index = 0; index < code.length; index += 1) {
		const current = code[index]!;
		const next = code[index + 1];
		if (state === "template") {
			output[index] = current === "\n" || current === "\r" ? current : " ";
			if (current === "\\") {
				if (next !== undefined) output[index + 1] = " ";
				index += 1;
			} else if (current === "$" && next === "{") {
				output[index + 1] = " ";
				templateExpressionDepth = 1;
				state = "code";
				index += 1;
			} else if (current === "`") {
				templateExpressionDepth = templateReturnDepths.pop();
				state = "code";
			}
			continue;
		}
		if (state === "code") {
			if (templateExpressionDepth !== undefined && current === "{") {
				templateExpressionDepth += 1;
			} else if (
				templateExpressionDepth !== undefined &&
				current === "}"
			) {
				templateExpressionDepth -= 1;
				if (templateExpressionDepth === 0) {
					output[index] = " ";
					templateExpressionDepth = undefined;
					state = "template";
				}
			} else if (current === "/" && next === "/") {
				output[index] = output[index + 1] = " ";
				state = "line-comment";
				index += 1;
			} else if (current === "/" && next === "*") {
				output[index] = output[index + 1] = " ";
				state = "block-comment";
				index += 1;
			} else if (current === "/" && isRegexLiteralStart(code, index)) {
				output[index] = " ";
				regexClass = false;
				state = "regex";
			} else if (current === '"' || current === "'") {
				output[index] = " ";
				quote = current;
				state = "string";
			} else if (current === "`") {
				output[index] = " ";
				templateReturnDepths.push(templateExpressionDepth);
				templateExpressionDepth = undefined;
				state = "template";
			}
			continue;
		}
		if (state === "line-comment") {
			if (current === "\n" || current === "\r") state = "code";
			else output[index] = " ";
			continue;
		}
		if (state === "regex") {
			output[index] = current === "\n" || current === "\r" ? current : " ";
			if (current === "\\") {
				if (next !== undefined) output[index + 1] = " ";
				index += 1;
			} else if (current === "[") regexClass = true;
			else if (current === "]") regexClass = false;
			else if (current === "/" && !regexClass) state = "code";
			continue;
		}
		output[index] = current === "\n" || current === "\r" ? current : " ";
		if (state === "block-comment") {
			if (current === "*" && next === "/") {
				output[index + 1] = " ";
				state = "code";
				index += 1;
			}
			continue;
		}
		if (current === "\\") {
			if (next !== undefined) output[index + 1] = " ";
			index += 1;
		} else if (current === quote) {
			state = "code";
			quote = "";
		}
	}
	return output.join("");
}

function isRegexLiteralStart(code: string, index: number): boolean {
	const previous = code.slice(0, index).trimEnd();
	if (!previous) return true;
	if ("([{:;,=!?&|+-*%^~<>".includes(previous.at(-1)!)) return true;
	return /(?:^|[^\w$])(return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)$/.test(previous);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shutdownDeadline(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function abortError(): Error {
	const error = new Error("Code-mode operation aborted");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}
