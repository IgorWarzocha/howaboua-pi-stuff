import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { formatDynamicToolHelp } from "./prompt.js";
import { runDynamicTool } from "./runner.js";
import type {
	CodeModeToolDefinition,
	DynamicToolDefinition,
	RuntimeContentItem,
	RuntimeResponse,
	RuntimeToolResult,
	RuntimeToolTrace,
	ToolExecutionContext,
} from "./types.js";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_QUEUED_WRITE_BYTES = 128 * 1024 * 1024;
const MAX_TRACE_COUNT = 50;
const MAX_TRACE_INPUT_CHARS = 16_384;
const MAX_TRACE_TEXT_CHARS = 32_768;
const MAX_TRACE_DETAILS_CHARS = 65_536;
const MAX_TRACE_IMAGE_CHARS = 16 * 1024 * 1024;
const MAX_TRACE_ERROR_CHARS = 16_384;
const MAX_SERIALIZED_NODES = 4_096;
export const MAX_CODE_MODE_OUTPUT_TOKENS = 100_000;

type Pending = {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	context?: ToolExecutionContext | undefined;
	tools?: Map<string, CodeModeToolDefinition> | undefined;
};

type HostClientOptions = {
	binary: string;
	tools: CodeModeToolDefinition[];
};

export class CodeModeHostClient {
	private readonly binary: string;
	private readonly tools: Map<string, CodeModeToolDefinition>;
	private readonly sessionId = randomUUID();
	private child: ChildProcessWithoutNullStreams | undefined;
	private buffer = Buffer.alloc(0);
	private requestId = 0;
	private ready: Promise<void> | undefined;
	private pending = new Map<number, Pending>();
	private initial = new Map<number, Pending>();
	private cellContexts = new Map<string, ToolExecutionContext>();
	private cellTools = new Map<string, Map<string, CodeModeToolDefinition>>();
	private cellTraces = new Map<string, RuntimeToolTrace[]>();
	private droppedTraceCounts = new Map<string, number>();
	private delegates = new Map<number, AbortController>();
	private notifications = new Map<string, string[]>();
	private stderr = "";
	private queuedWriteBytes = 0;

	constructor(options: HostClientOptions) {
		this.binary = options.binary;
		this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
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
			this.pending.set(0, { resolve, reject });
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
		const id = ++this.requestId;
		const initial = new Promise<any>((resolve, reject) =>
			this.initial.set(id, { resolve, reject }),
		);
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
					yield_time_ms: yieldTimeMs,
					max_output_tokens: maxOutputTokens,
				},
			},
			context,
			toolSet,
		);
		let cellId: string | undefined;
		const abort = () => {
			try {
				this.send({ type: "operation/cancel", id });
			} catch {
				// Host teardown is already authoritative.
			}
			if (cellId) void this.terminate(cellId).catch(() => undefined);
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const startedValue = await started;
			cellId =
				typeof startedValue?.cellId === "string"
					? startedValue.cellId
					: undefined;
			if (signal?.aborted) {
				abort();
				throw abortError();
			}
			return {
				...this.withNotifications(parseRuntimeResponse(await initial)),
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
		this.cellContexts.set(cellId, context);
		const id = ++this.requestId;
		const abort = () => {
			try {
				this.send({ type: "operation/cancel", id });
			} catch {
				// Host teardown is already authoritative.
			}
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
			const wrapped = value.outcome?.LiveCell ?? value.outcome?.MissingCell;
			if (!wrapped)
				throw new Error("Code-mode host returned an invalid wait outcome");
			return this.withNotifications(parseRuntimeResponse(wrapped));
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	async terminate(cellId: string): Promise<RuntimeResponse> {
		await this.start();
		const value = await this.request({
			method: "session/terminate",
			sessionId: this.sessionId,
			cellId,
		});
		const wrapped = value.outcome?.LiveCell ?? value.outcome?.MissingCell;
		if (!wrapped)
			throw new Error("Code-mode host returned an invalid termination outcome");
		return this.withNotifications(parseRuntimeResponse(wrapped));
	}

	async shutdown(): Promise<void> {
		const child = this.child;
		if (!child) return;
		try {
			await this.request({
				method: "session/shutdown",
				sessionId: this.sessionId,
			});
		} catch {
			// Process teardown below is authoritative.
		}
		child.kill();
		this.failAll(new Error("Code-mode host shut down"));
		this.cellContexts.clear();
		this.cellTools.clear();
		this.cellTraces.clear();
		this.droppedTraceCounts.clear();
		this.notifications.clear();
		this.child = undefined;
		this.ready = undefined;
	}

	private request(
		request: Record<string, unknown>,
		context?: ToolExecutionContext,
	): Promise<any> {
		return this.requestWithId(++this.requestId, request, context);
	}

	private requestWithId(
		id: number,
		request: Record<string, unknown>,
		context?: ToolExecutionContext,
		tools?: Map<string, CodeModeToolDefinition>,
	): Promise<any> {
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
				this.handleMessage(JSON.parse(payload.toString("utf8")));
			} catch (error) {
				this.failAll(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}

	private handleMessage(message: any): void {
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
			if (message.result?.status === "error")
				return pending.reject(new Error(message.result.message));
			const value = message.result?.value;
			if (value?.type === "execution/started" && pending.context) {
				this.cellContexts.set(value.cellId, pending.context);
				if (pending.tools) this.cellTools.set(value.cellId, pending.tools);
			}
			pending.resolve(value);
			return;
		}
		if (message.type === "execute/initialResponse") {
			const pending = this.initial.get(message.id);
			this.initial.delete(message.id);
			if (!pending) return;
			if (message.result?.status === "error")
				pending.reject(new Error(message.result.message));
			else pending.resolve(message.result?.value);
			return;
		}
		if (message.type === "delegate/request") {
			const controller = new AbortController();
			this.delegates.set(message.id, controller);
			void this.handleDelegate(message, controller);
			return;
		}
		if (message.type === "delegate/cancel") {
			const controller = this.delegates.get(message.id);
			this.delegates.delete(message.id);
			controller?.abort();
			return;
		}
		if (message.type === "cell/closed") {
			this.cellContexts.delete(message.cellId);
			this.cellTools.delete(message.cellId);
		}
	}

	private async handleDelegate(
		message: any,
		controller: AbortController,
	): Promise<void> {
		const request = message.request;
		if (request?.type === "notification/send") {
			const context = this.cellContexts.get(request.cellId);
			if (!context) {
				this.send({
					type: "delegate/response",
					id: message.id,
					result: {
						status: "error",
						message: "Code-mode notification cell is unavailable",
					},
				});
				this.delegates.delete(message.id);
				return;
			}
			const notifications = this.notifications.get(request.cellId) ?? [];
			const text = String(request.text).slice(0, 16_384);
			notifications.push(text);
			if (notifications.length > 100)
				notifications.splice(0, notifications.length - 100);
			this.notifications.set(request.cellId, notifications);
			context?.onUpdate?.({
				content: [{ type: "text", text }],
				details: { cellId: request.cellId, notification: true },
			});
			this.send({
				type: "delegate/response",
				id: message.id,
				result: { status: "ok", value: { type: "notification/delivered" } },
			});
			this.delegates.delete(message.id);
			return;
		}
		if (request?.type !== "tool/invoke") {
			this.send({
				type: "delegate/response",
				id: message.id,
				result: {
					status: "error",
					message: "Unsupported code-mode delegate request",
				},
			});
			this.delegates.delete(message.id);
			return;
		}
		const invocation = request.invocation;
		const cellId = invocation?.cell_id;
		const tool = this.cellTools.get(cellId)?.get(invocation?.tool_name?.name);
		const context = this.cellContexts.get(cellId);
		if (!tool || !context) {
			this.send({
				type: "delegate/response",
				id: message.id,
				result: {
					status: "error",
					message: !tool
						? `Unknown dynamic tool: ${invocation?.tool_name?.name}`
						: "Code-mode cell context is unavailable",
				},
			});
			this.delegates.delete(message.id);
			return;
		}
		const trace = this.startTrace(
			cellId,
			String(invocation?.runtime_tool_call_id ?? message.id),
			tool.name,
			invocation.input,
		);
		const invocationContext: ToolExecutionContext = {
			...context,
			toolCallId: trace.id,
			onUpdate: (update) => {
				trace.result = this.boundToolResult(cellId, trace, update);
				this.emitTraceUpdate(cellId, context);
			},
			captureResult: (result) => {
				trace.result = this.boundToolResult(cellId, trace, result);
				this.emitTraceUpdate(cellId, context);
			},
			refreshTrace: () => this.emitTraceUpdate(cellId, context),
		};
		try {
			if (isDynamicToolDefinition(tool)) this.emitTraceUpdate(cellId, context);
			const result = isDynamicToolDefinition(tool)
				? await runDynamicTool(
						tool,
						invocation.input,
						invocationContext.cwd,
						controller.signal,
					)
				: await tool.invoke(
						invocation.input,
						invocationContext,
						controller.signal,
					);
			if (!trace.result)
				trace.result = this.boundToolResult(
					cellId,
					trace,
					toolResultFromValue(result),
				);
			trace.status = "done";
			this.emitTraceUpdate(cellId, context);
			this.sendDelegateResponse(message.id, {
				status: "ok",
				value: { type: "tool/result", result },
			});
		} catch (error) {
			trace.status = "error";
			trace.error = truncateTraceText(
				error instanceof Error ? error.message : String(error),
				MAX_TRACE_ERROR_CHARS,
			);
			this.emitTraceUpdate(cellId, context);
			this.sendDelegateResponse(message.id, {
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.delegates.delete(message.id);
		}
	}

	private failAll(error: Error): void {
		for (const pending of [...this.pending.values(), ...this.initial.values()])
			pending.reject(error);
		this.pending.clear();
		this.initial.clear();
		for (const controller of this.delegates.values()) controller.abort();
		this.delegates.clear();
		this.cellContexts.clear();
		this.cellTools.clear();
		this.cellTraces.clear();
		this.droppedTraceCounts.clear();
		this.notifications.clear();
		this.queuedWriteBytes = 0;
		const child = this.child;
		this.child = undefined;
		this.ready = undefined;
		if (child && !child.killed) child.kill();
	}

	private withNotifications(response: RuntimeResponse): RuntimeResponse {
		const notifications = this.notifications.get(response.cellId) ?? [];
		this.notifications.delete(response.cellId);
		const traces = this.cellTraces.get(response.cellId)?.map(cloneTrace);
		const droppedTraceCount = this.droppedTraceCounts.get(response.cellId) ?? 0;
		if (response.kind !== "yielded") {
			this.cellTraces.delete(response.cellId);
			this.droppedTraceCounts.delete(response.cellId);
		}
		const withTraces =
			traces && traces.length > 0
				? {
						...response,
						traces,
						...(droppedTraceCount > 0 ? { droppedTraceCount } : {}),
					}
				: response;
		if (notifications.length === 0) return withTraces;
		return {
			...withTraces,
			contentItems: [
				...notifications.map((text) => ({ type: "input_text" as const, text })),
				...response.contentItems,
			],
		};
	}

	private startTrace(
		cellId: string,
		id: string,
		name: string,
		input: unknown,
	): RuntimeToolTrace {
		const traces = this.cellTraces.get(cellId) ?? [];
		if (traces.length >= MAX_TRACE_COUNT) {
			traces.shift();
			this.droppedTraceCounts.set(
				cellId,
				(this.droppedTraceCounts.get(cellId) ?? 0) + 1,
			);
		}
		const trace: RuntimeToolTrace = {
			id,
			name,
			input: sanitizeValue(input, { remaining: MAX_TRACE_INPUT_CHARS }),
			status: "running",
		};
		traces.push(trace);
		this.cellTraces.set(cellId, traces);
		return trace;
	}

	private emitTraceUpdate(cellId: string, context: ToolExecutionContext): void {
		try {
			context.onUpdate?.({
				content: [],
				details: {
					cellId,
					status: "running",
					traces: (this.cellTraces.get(cellId) ?? []).map(cloneTrace),
					...(this.droppedTraceCounts.get(cellId)
						? { droppedTraceCount: this.droppedTraceCounts.get(cellId) }
						: {}),
				},
			});
		} catch {
			// Rendering updates must not change nested tool execution.
		}
	}

	private sendDelegateResponse(
		id: number,
		result: Record<string, unknown>,
	): void {
		try {
			this.send({ type: "delegate/response", id, result });
		} catch (error) {
			try {
				this.send({
					type: "delegate/response",
					id,
					result: {
						status: "error",
						message: `Failed to serialize nested tool result: ${error instanceof Error ? error.message : String(error)}`,
					},
				});
			} catch {
				// Host teardown will reject the owning operation.
			}
		}
	}

	private boundToolResult(
		cellId: string,
		current: RuntimeToolTrace,
		result: RuntimeToolResult,
	): RuntimeToolResult {
		const usedImageChars = (this.cellTraces.get(cellId) ?? [])
			.filter((trace) => trace !== current)
			.flatMap((trace) => trace.result?.content ?? [])
			.reduce(
				(total, item) =>
					total + (item.type === "image" && item.data ? item.data.length : 0),
				0,
			);
		return boundRuntimeToolResult(
			result,
			Math.max(0, MAX_TRACE_IMAGE_CHARS - usedImageChars),
		);
	}
}

function toolResultFromValue(value: unknown): RuntimeToolResult {
	return {
		content: [
			{
				type: "text",
				text:
					typeof value === "string"
						? value
						: safeStringify(value, "(non-serializable tool result)"),
			},
		],
	};
}

function cloneTrace(trace: RuntimeToolTrace): RuntimeToolTrace {
	return sanitizeValue(trace, {
		remaining: Number.MAX_SAFE_INTEGER,
	}) as RuntimeToolTrace;
}

function boundRuntimeToolResult(
	result: RuntimeToolResult,
	imageCharsRemaining: number,
): RuntimeToolResult {
	let textRemaining = MAX_TRACE_TEXT_CHARS;
	let imageRemaining = imageCharsRemaining;
	let omittedImages = 0;
	const content: RuntimeToolResult["content"] = [];
	for (const item of result.content) {
		if (item.type === "text" && typeof item.text === "string") {
			const text = truncateTraceText(item.text, textRemaining);
			textRemaining = Math.max(0, textRemaining - text.length);
			if (text) content.push({ ...item, text });
			continue;
		}
		if (item.type === "image" && typeof item.data === "string") {
			if (item.data.length <= imageRemaining) {
				imageRemaining -= item.data.length;
				content.push({ ...item });
			} else {
				omittedImages += 1;
			}
			continue;
		}
		content.push(
			sanitizeValue(item, {
				remaining: MAX_TRACE_TEXT_CHARS,
			}) as RuntimeToolResult["content"][number],
		);
	}
	if (omittedImages > 0) {
		content.push({
			type: "text",
			text: `[${omittedImages} nested image${omittedImages === 1 ? "" : "s"} omitted from trace]`,
		});
	}
	return {
		content,
		...(result.details === undefined
			? {}
			: {
					details: sanitizeValue(result.details, {
						remaining: MAX_TRACE_DETAILS_CHARS,
					}),
				}),
	};
}

function truncateTraceText(text: string, remaining: number): string {
	if (remaining <= 0) return "";
	if (text.length <= remaining) return text;
	const marker = "\n[Trace output truncated]";
	return `${text.slice(0, Math.max(0, remaining - marker.length))}${marker}`;
}

interface SerializationBudget {
	remaining: number;
	nodesRemaining?: number;
	seen?: WeakSet<object>;
	depth?: number;
}

function sanitizeValue(value: unknown, budget: SerializationBudget): unknown {
	const depth = budget.depth ?? 0;
	const nodesRemaining = budget.nodesRemaining ?? MAX_SERIALIZED_NODES;
	if (nodesRemaining <= 0 || budget.remaining <= 0) return "[value limit]";
	budget.nodesRemaining = nodesRemaining - 1;
	budget.remaining = Math.max(0, budget.remaining - 1);
	if (value === null || value === undefined || typeof value === "boolean")
		return value;
	if (typeof value === "number") {
		budget.remaining = Math.max(0, budget.remaining - 8);
		return Number.isFinite(value) ? value : String(value);
	}
	if (
		typeof value === "bigint" ||
		typeof value === "symbol" ||
		typeof value === "function"
	)
		return sanitizeValue(String(value), budget);
	if (typeof value === "string") {
		const available = Math.max(0, budget.remaining);
		budget.remaining -= Math.min(value.length, available);
		return value.length <= available
			? value
			: `${value.slice(0, Math.max(0, available - 21))}[value truncated]`;
	}
	if (depth >= 12) return "[depth limit]";
	if (typeof value !== "object") return String(value);
	const seen = budget.seen ?? new WeakSet<object>();
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	const childBudget = { ...budget, seen, depth: depth + 1 };
	if (Array.isArray(value)) {
		const output: unknown[] = [];
		for (const item of value) {
			if (budget.remaining <= 0) {
				output.push("[values omitted]");
				break;
			}
			output.push(sanitizeValue(item, childBudget));
			budget.remaining = childBudget.remaining;
			budget.nodesRemaining = childBudget.nodesRemaining ?? 0;
		}
		return output;
	}
	if (value instanceof Date) return value.toISOString();
	const output: Record<string, unknown> = {};
	let entries: Array<[string, unknown]>;
	try {
		entries = Object.entries(value);
	} catch {
		return "[unavailable object]";
	}
	for (const [key, entry] of entries) {
		if (budget.remaining <= 0) {
			output["trace_truncated"] = true;
			break;
		}
		childBudget.remaining = Math.max(0, childBudget.remaining - key.length - 1);
		output[key] = sanitizeValue(entry, childBudget);
		budget.remaining = childBudget.remaining;
		budget.nodesRemaining = childBudget.nodesRemaining ?? 0;
	}
	return output;
}

function safeStringify(value: unknown, fallback: string): string {
	try {
		return (
			JSON.stringify(
				sanitizeValue(value, { remaining: MAX_TRACE_TEXT_CHARS }),
			) ?? fallback
		);
	} catch {
		return fallback;
	}
}

function toWireToolDefinition(tool: CodeModeToolDefinition) {
	if (
		!isDynamicToolDefinition(tool) &&
		tool.kind === "function" &&
		!tool.inputSchema
	)
		throw new Error(
			`Function code-mode tool requires inputSchema: ${tool.name}`,
		);
	return {
		name: tool.name,
		tool_name: { name: tool.name, namespace: null },
		description: formatDynamicToolHelp(tool),
		kind: isDynamicToolDefinition(tool) ? "freeform" : tool.kind,
		input_schema:
			isDynamicToolDefinition(tool) || tool.kind === "freeform"
				? null
				: (tool.inputSchema ?? null),
		output_schema: null,
	};
}

function isDynamicToolDefinition(
	tool: CodeModeToolDefinition,
): tool is DynamicToolDefinition {
	return "command" in tool;
}

function parseExecSource(source: string): {
	code: string;
	yieldTimeMs: number | null;
	maxOutputTokens: number | null;
} {
	if (!source.trim())
		throw new Error("exec requires non-empty JavaScript source");
	const [first, ...rest] = source.split("\n");
	const trimmed = first?.trimStart() ?? "";
	if (!trimmed.startsWith("// @exec:"))
		return { code: source, yieldTimeMs: null, maxOutputTokens: null };
	if (rest.join("\n").trim() === "")
		throw new Error("exec pragma must be followed by JavaScript source");
	const options = JSON.parse(
		trimmed.slice("// @exec:".length).trim(),
	) as Record<string, unknown>;
	for (const key of Object.keys(options))
		if (key !== "yield_time_ms" && key !== "max_output_tokens")
			throw new Error(`Unsupported exec pragma field: ${key}`);
	const integer = (
		value: unknown,
		name: string,
		minimum = 0,
		maximum = Number.MAX_SAFE_INTEGER,
	): number | null => {
		if (value === undefined) return null;
		if (
			!Number.isSafeInteger(value) ||
			Number(value) < minimum ||
			Number(value) > maximum
		)
			throw new Error(
				`${name} must be a safe integer from ${minimum} to ${maximum}`,
			);
		return Number(value);
	};
	return {
		code: rest.join("\n"),
		yieldTimeMs: integer(options["yield_time_ms"], "yield_time_ms"),
		maxOutputTokens: integer(
			options["max_output_tokens"],
			"max_output_tokens",
			1,
			MAX_CODE_MODE_OUTPUT_TOKENS,
		),
	};
}

function abortError(): Error {
	const error = new Error("Code-mode operation aborted");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function parseRuntimeResponse(value: any): RuntimeResponse {
	const kind = value?.Yielded
		? "yielded"
		: value?.Terminated
			? "terminated"
			: value?.Result
				? "result"
				: undefined;
	if (!kind)
		throw new Error("Code-mode host returned an invalid runtime response");
	const body =
		value[
			kind === "yielded"
				? "Yielded"
				: kind === "terminated"
					? "Terminated"
					: "Result"
		];
	return {
		kind,
		cellId: body.cell_id,
		contentItems: (body.content_items ?? []) as RuntimeContentItem[],
		...(kind === "result" && body.error_text
			? { errorText: body.error_text }
			: {}),
	};
}
