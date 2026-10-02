import { runCustomTool } from "./custom-tool-runner.js";
import { mcpToolNamespaces, missingMcpToolMessage } from "./mcp-tool-recovery.js";
import { isCustomToolDefinition, type DelegateRequestMessage } from "./host-protocol.js";
import { runCodeModeToolWithHooks } from "./nested-tool-completion.js";
import { codeModeNameForToolIdentity } from "./tool-identity.ts";
import { CodeModeNestedRenderStore } from "./trace-render-state.js";
import { CodeModeTraceStore } from "./trace-store.js";
import { toolResultFromValue, truncateTraceText } from "./trace-values.js";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	OpaqueToolOutput,
	RuntimeContentItem,
	ToolExecutionContext,
} from "./types.js";

const MAX_TRACE_ERROR_CHARS = 16_384;
const MAX_NOTIFICATION_CHARS = 16_384;
const MAX_NOTIFICATIONS_PER_CELL = 100;
const MAX_OPAQUE_CALLS_PER_CELL = 32;
const MAX_OPAQUE_BYTES = 32 * 1024 * 1024;
const OPAQUE_TTL_MS = 15 * 60_000;

interface DelegateController {
	cellId?: string | undefined;
	controller: AbortController;
}

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

interface PendingOpaqueResults {
	outputs: OpaqueToolOutput[];
	images: RuntimeContentItem[];
	calls: number;
	bytes: number;
	expires: number;
	timer?: ReturnType<typeof setTimeout>;
}

type SendMessage = (message: unknown) => void;

export class CodeModeDelegateRuntime {
	private readonly traceRuntimeGeneration = crypto.randomUUID();
	private readonly cellContexts = new Map<string, ToolExecutionContext>();
	private readonly contextChanges = new Map<string, Deferred>();
	private readonly cellTools = new Map<string, Map<string, CodeModeToolDefinition>>();
	private readonly controllers = new Map<string, DelegateController>();
	private readonly notifications = new Map<string, string[]>();
	private readonly opaqueResults = new Map<string, PendingOpaqueResults>();
	private readonly originalExecCalls = new Map<string, string>();
	// Continuation routing must survive bounded display traces.
	private readonly execSessions = new Map<string, Set<number>>();
	private readonly terminatingCells = new Set<string>();
	private readonly contextNoteWrites = new Map<string, boolean>();
	private readonly blockers = new Map<string, Set<string>>();
	private readonly blockerChanges = new Map<string, Deferred>();
	private readonly sequentialTails = new Map<string, Promise<void>>();
	private readonly traces = new CodeModeTraceStore();
	private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly send: SendMessage;
	private readonly renderStore: CodeModeNestedRenderStore;

	constructor(
		send: SendMessage,
		renderStore = new CodeModeNestedRenderStore(),
	) {
		this.send = send;
		this.renderStore = renderStore;
	}

	bindCell(
		cellId: string,
		context: ToolExecutionContext,
		tools?: Map<string, CodeModeToolDefinition>,
	): void {
		this.updateCellContext(cellId, context);
		if (context.originalExecCallId && !this.originalExecCalls.has(cellId))
			this.originalExecCalls.set(cellId, context.originalExecCallId);
		if (tools) this.cellTools.set(cellId, tools);
	}

	updateCellContext(cellId: string, context: ToolExecutionContext): void {
		const previous = this.cellContexts.get(cellId);
		if (previous?.opaqueScope && (previous.opaqueScope !== context.opaqueScope ||
			previous.opaqueContextGeneration !== context.opaqueContextGeneration))
			throw new Error("Remote cell belongs to a different context; verify note state before repeating a write");
		this.cellContexts.set(cellId, context);
		this.contextChanges.get(cellId)?.resolve();
		this.contextChanges.delete(cellId);
	}

	closeCell(cellId: string): void {
		this.cellContexts.delete(cellId);
		this.contextChanges.get(cellId)?.resolve();
		this.contextChanges.delete(cellId);
		this.cellTools.delete(cellId);
		this.blockers.delete(cellId);
		this.blockerChanges.get(cellId)?.resolve();
		this.blockerChanges.delete(cellId);
		this.sequentialTails.delete(cellId);
		const previous = this.cleanupTimers.get(cellId);
		if (previous) clearTimeout(previous);
		this.cleanupTimers.set(cellId, setTimeout(() => {
			this.cleanupTimers.delete(cellId);
			this.notifications.delete(cellId);
			const opaque = this.opaqueResults.get(cellId);
			if (opaque?.timer) clearTimeout(opaque.timer);
			this.opaqueResults.delete(cellId);
			this.originalExecCalls.delete(cellId);
			this.execSessions.delete(cellId);
			this.terminatingCells.delete(cellId);
			this.contextNoteWrites.delete(cellId);
			this.traces.delete(cellId);
		}, 1_000));
	}

	clear(): void {
		for (const { controller } of this.controllers.values()) controller.abort();
		this.controllers.clear();
		this.cellContexts.clear();
		this.originalExecCalls.clear();
		for (const change of this.contextChanges.values()) change.resolve();
		this.contextChanges.clear();
		this.cellTools.clear();
		this.traces.clear();
		this.renderStore.clear();
		this.notifications.clear();
		this.clearOpaqueResults();
		this.execSessions.clear();
		this.terminatingCells.clear();
		this.contextNoteWrites.clear();
		for (const change of this.blockerChanges.values()) change.resolve();
		this.blockers.clear();
		this.blockerChanges.clear();
		this.sequentialTails.clear();
		for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
		this.cleanupTimers.clear();
	}

	clearOpaqueResults(): void {
		for (const [cellId, entry] of this.opaqueResults) {
			this.cancelCell(cellId);
			if (entry.timer) clearTimeout(entry.timer);
		}
		this.opaqueResults.clear();
	}

	isBlocked(cellId: string): boolean {
		return (this.blockers.get(cellId)?.size ?? 0) > 0;
	}

	async waitUntilUnblocked(cellId: string, signal?: AbortSignal): Promise<void> {
		while (this.isBlocked(cellId)) {
			const change = this.blockerChanges.get(cellId) ?? deferred();
			this.blockerChanges.set(cellId, change);
			await waitForChange(change.promise, signal);
		}
	}

	cancel(id: number): void {
		const key = hostControllerKey(id);
		const pending = this.controllers.get(key);
		this.controllers.delete(key);
		pending?.controller.abort();
	}

	cancelCell(cellId: string): void {
		for (const [key, pending] of this.controllers) {
			if (pending.cellId !== cellId) continue;
			this.controllers.delete(key);
			pending.controller.abort();
		}
	}

	handleRequest(message: DelegateRequestMessage): void {
		const key = hostControllerKey(message.id);
		if (this.controllers.has(key))
			throw new Error(`Duplicate code-mode delegate request: ${message.id}`);
		const controller = new AbortController();
		const cellId = message.request.type === "notification/send"
			? message.request.cellId
			: message.request.invocation.cell_id;
		this.controllers.set(key, { cellId, controller });
		void this.invoke(message, key, controller);
	}

	async invokeDirect(
		cellId: string,
		requestId: number,
		toolName: string,
		input: unknown,
	): Promise<unknown> {
		const key = directControllerKey(cellId, requestId);
		if (this.controllers.has(key))
			throw new Error(`Duplicate code-mode delegate request: ${requestId}`);
		const controller = new AbortController();
		this.controllers.set(key, { cellId, controller });
		try {
			return await this.invokeTool(cellId, toolName, input, String(requestId), controller);
		} finally {
			this.controllers.delete(key);
		}
	}

	notifyDirect(cellId: string, value: string): void {
		const context = this.cellContexts.get(cellId);
		if (!context) throw new Error("Code-mode notification cell is unavailable");
		const notifications = this.notifications.get(cellId) ?? [];
		const text = value.slice(0, MAX_NOTIFICATION_CHARS);
		notifications.push(text);
		if (notifications.length > MAX_NOTIFICATIONS_PER_CELL)
			notifications.splice(0, notifications.length - MAX_NOTIFICATIONS_PER_CELL);
		this.notifications.set(cellId, notifications);
		context.onUpdate?.({
			content: [{ type: "text", text }],
			details: { cellId, notification: true },
		});
	}

	attach(response: RuntimeResponse): RuntimeResponse {
		const originalExecCallId = this.originalExecCalls.get(response.cellId);
		if (response.kind !== "yielded") this.originalExecCalls.delete(response.cellId);
		const cleanupTimer = this.cleanupTimers.get(response.cellId);
		if (cleanupTimer) clearTimeout(cleanupTimer);
		this.cleanupTimers.delete(response.cellId);
		const notifications = this.notifications.get(response.cellId) ?? [];
		this.notifications.delete(response.cellId);
		const opaque = this.opaqueResults.get(response.cellId);
		const opaqueOutputs = opaque?.outputs;
		const opaqueImages = opaque?.images;
		if (opaque) {
			if (opaque.expires <= Date.now())
				throw new Error("Remote results expired after execution; verify note state before repeating a write");
			if (response.kind === "yielded") {
				opaque.outputs = [];
				opaque.images = [];
				opaque.bytes = 0;
			} else {
				if (opaque.timer) clearTimeout(opaque.timer);
				this.opaqueResults.delete(response.cellId);
			}
		}
		const execSessionIds = [...(this.execSessions.get(response.cellId) ?? [])];
		if (response.kind !== "yielded") this.execSessions.delete(response.cellId);
		const noteWrites = this.contextNoteWrites.get(response.cellId);
		const terminate = response.kind === "result" && !response.errorText && noteWrites !== false && this.terminatingCells.has(response.cellId);
		if (response.kind !== "yielded") this.terminatingCells.delete(response.cellId);
		if (response.kind !== "yielded") this.contextNoteWrites.delete(response.cellId);
		const withTraces = this.traces.attach(response);
		return {
			...withTraces,
			...(originalExecCallId ? { originalExecCallId } : {}),
			...(opaqueOutputs?.length ? { opaqueOutputs } : {}),
			...(terminate ? { terminate: true as const } : {}),
			...(noteWrites !== undefined && response.kind !== "yielded"
				? { contextNotesSaved: response.kind === "result" && !response.errorText && noteWrites }
				: {}),
			...(noteWrites !== undefined && opaque && response.kind !== "yielded" ? { contextNotesSource: "remote" as const } : {}),
			...(execSessionIds.length > 0 ? { execSessionIds } : {}),
			contentItems: [
				...notifications.map((text) => ({ type: "input_text" as const, text })),
				...response.contentItems,
				...(opaqueImages ?? []),
			],
		};
	}

	private async invoke(
		message: DelegateRequestMessage,
		key: string,
		controller: AbortController,
	): Promise<void> {
		const request = message.request;
		if (request.type === "notification/send") {
			this.handleNotification(message.id, key, request);
			return;
		}
		const invocation = request.invocation;
		const cellId = invocation.cell_id;
		const toolName = codeModeNameForToolIdentity(invocation.tool_name);
		const input = invocation?.input;
		try {
			const result = await this.invokeTool(
				cellId,
				toolName,
				input,
				String(invocation?.runtime_tool_call_id ?? message.id),
				controller,
			);
			this.respond(message.id, {
				status: "ok",
				value: { type: "tool/result", result },
			});
		} catch (error) {
			this.respond(message.id, {
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.controllers.delete(key);
		}
	}

	private async invokeTool(
		cellId: string,
		toolName: string,
		input: unknown,
		traceId: string,
		controller: AbortController,
	): Promise<unknown> {
		const tool = this.cellTools.get(cellId)?.get(toolName);
		const context = this.cellContexts.get(cellId);
		if (!tool) throw new Error(
			missingMcpToolMessage(toolName, mcpToolNamespaces(this.cellTools.get(cellId)?.values() ?? []))
				?? `Unknown custom tool: ${toolName}`,
		);
		if (!context) throw new Error("Code-mode cell context is unavailable");
		const opaqueResult = !isCustomToolDefinition(tool) && tool.opaqueResult === true;
		const currentContext = () => this.cellContexts.get(cellId) ?? context;
		const emitTrace = () => this.traces.emitUpdate(cellId, currentContext());
		const trace = this.traces.start(
			cellId,
			`${this.traceRuntimeGeneration}:${cellId}:${traceId}`,
			tool.name,
			input,
		);
		const captureRendererValues =
			!isCustomToolDefinition(tool) &&
			Boolean(tool.renderCall || tool.renderResult);
		let finalResultCaptured = false;
		let resultSessionId: number | undefined;
		const contextNoteWrite = !isCustomToolDefinition(tool) && tool.isContextNoteWrite?.(input) === true;
		if (captureRendererValues)
			this.renderStore.captureInput(trace.id, input);
		const invocationContext: ToolExecutionContext = {
			...context,
			toolCallId: trace.id,
			...(opaqueResult ? { captureOpaqueResult: (output: OpaqueToolOutput, images: RuntimeContentItem[]) => {
				const pending = this.opaqueResults.get(cellId);
				if (!pending || pending.expires <= Date.now() || controller.signal.aborted ||
					this.cellContexts.get(cellId)?.opaqueScope !== context.opaqueScope ||
					this.cellContexts.get(cellId)?.opaqueContextGeneration !== context.opaqueContextGeneration)
					throw new Error("Remote operation executed but result delivery was cancelled or expired; verify note state before repeating a write");
				const bytes = Buffer.byteLength(output.encryptedOutput, "utf8") + images.reduce((sum, image) => sum + (image.image_url?.length ?? 0), 0);
				const total = [...this.opaqueResults.values()].reduce((sum, entry) => sum + entry.bytes, 0);
				if (total + bytes > MAX_OPAQUE_BYTES)
					throw new Error("Remote operation executed but result capacity was exceeded; verify note state before repeating a write");
				pending.bytes += bytes;
				pending.outputs.push(output);
				pending.images.push(...images);
			} } : {}),
			...(!isCustomToolDefinition(tool) && tool.executionPipeline === "pi"
				? { preflight: undefined, completion: undefined }
				: {}),
			executeTool: (name, args, options) => this.executePiTool(cellId, name, args, { ...options, signal: options?.signal ?? controller.signal }),
			onUpdate: (update) => {
				if (captureRendererValues)
					this.renderStore.captureResult(trace.id, update);
				trace.result = this.traces.captureResult(cellId, trace, update);
				emitTrace();
			},
			captureResult: (result) => {
				finalResultCaptured = true;
				if (!isCustomToolDefinition(tool) && tool.propagateTermination && result.terminate)
					this.terminatingCells.add(cellId);
				resultSessionId = numericSessionId(result.details);
				if (captureRendererValues)
					this.renderStore.captureResult(trace.id, result);
				trace.result = this.traces.captureResult(cellId, trace, result);
				emitTrace();
			},
			refreshTrace: emitTrace,
		};
		let blocking = false;
		let blockerActive = false;
		try {
			if (opaqueResult) {
				if (!context.opaqueContextValid || !await context.opaqueContextValid())
					throw new Error("Remote context changed; start a new exec cell");
				this.reserveOpaqueCall(cellId);
			}
			blocking =
				!isCustomToolDefinition(tool) &&
				(tool.blocking === true || tool.isBlocking?.(input) === true);
			if (blocking) {
				blockerActive = true;
				trace.status = "blocked";
				this.setBlocked(cellId, trace.id, true);
				emitTrace();
			}
			const result = await runCodeModeToolWithHooks(
				tool.name,
				input,
				invocationContext,
				controller.signal,
				async (hookContext) => {
					if (isCustomToolDefinition(tool)) emitTrace();
					controller.signal.throwIfAborted();
					const run = async (): Promise<unknown> => {
						return isCustomToolDefinition(tool)
							? await runCustomTool(tool, input, hookContext.cwd, controller.signal)
							: await tool.invoke(input, hookContext, controller.signal);
					};
					return !isCustomToolDefinition(tool) && tool.executionMode === "sequential"
						? await this.invokeSequential(cellId, controller.signal, run)
						: await run();
				},
			);
			if (contextNoteWrite) this.contextNoteWrites.set(cellId, this.contextNoteWrites.get(cellId) !== false);
			if (!trace.result)
				trace.result = this.traces.captureResult(cellId, trace, toolResultFromValue(result));
			trace.status = "done";
			this.recordExecSession(cellId, tool.name, input, finalResultCaptured ? resultSessionId : numericSessionId(result));
			emitTrace();
			return result;
		} catch (error) {
			if (contextNoteWrite) this.contextNoteWrites.set(cellId, false);
			const errorText =
				error instanceof Error ? error.message : String(error);
			if (captureRendererValues && !finalResultCaptured) {
				const errorResult = {
					content: [{ type: "text" as const, text: errorText }],
					details: {},
				};
				this.renderStore.captureResult(trace.id, errorResult);
				trace.result = this.traces.captureResult(
					cellId,
					trace,
					errorResult,
				);
			}
			trace.status = "error";
			trace.error = truncateTraceText(
				errorText,
				MAX_TRACE_ERROR_CHARS,
			);
			emitTrace();
			throw error;
		} finally {
			if (blockerActive) this.setBlocked(cellId, trace.id, false);
		}
	}

	private async executePiTool(
		cellId: string,
		...[name, args, options]: Parameters<NonNullable<ToolExecutionContext["executeTool"]>>
	): ReturnType<NonNullable<ToolExecutionContext["executeTool"]>> {
		while (true) {
			options?.signal?.throwIfAborted();
			const scope = this.cellContexts.get(cellId)?.piToolScope;
			if (!scope) throw new Error("Pi nested tool call context is unavailable");
			const pending = scope.run(name, args, options);
			if (pending) return pending;
			const change = this.contextChanges.get(cellId) ?? deferred();
			this.contextChanges.set(cellId, change);
			await waitForChange(change.promise, options?.signal);
		}
	}

	private recordExecSession(cellId: string, toolName: string, input: unknown, resultSessionId: number | undefined): void {
		if (toolName !== "exec_command" && toolName !== "write_stdin") return;
		const sessions = this.execSessions.get(cellId) ?? new Set<number>();
		const inputSessionId = numericSessionId(input);
		if (toolName === "write_stdin" && inputSessionId !== undefined) sessions.delete(inputSessionId);
		if (resultSessionId !== undefined) sessions.add(resultSessionId);
		if (sessions.size > 0) this.execSessions.set(cellId, sessions);
		else this.execSessions.delete(cellId);
	}

	private reserveOpaqueCall(cellId: string): void {
		for (const [id, entry] of this.opaqueResults) {
			if (entry.expires > Date.now()) continue;
			this.cancelCell(id);
			if (entry.timer) clearTimeout(entry.timer);
			this.opaqueResults.delete(id);
		}
		const pending: PendingOpaqueResults = this.opaqueResults.get(cellId) ?? { outputs: [], images: [], calls: 0, bytes: 0, expires: Date.now() + OPAQUE_TTL_MS };
		if (pending.calls >= MAX_OPAQUE_CALLS_PER_CELL || (!this.opaqueResults.has(cellId) && this.opaqueResults.size >= 32))
			throw new Error("Remote batch capacity reached; finish pending cells, then start a new exec cell");
		pending.calls++;
		if (!pending.timer) {
			pending.timer = setTimeout(() => {
				this.cancelCell(cellId);
				this.opaqueResults.delete(cellId);
			}, Math.max(1, pending.expires - Date.now()));
			pending.timer.unref();
		}
		this.opaqueResults.set(cellId, pending);
	}

	private async invokeSequential(
		cellId: string,
		signal: AbortSignal,
		run: () => Promise<unknown>,
	): Promise<unknown> {
		let release: () => void;
		const turn = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = this.sequentialTails.get(cellId) ?? Promise.resolve();
		this.sequentialTails.set(cellId, previous.then(() => turn));
		try {
			await waitForChange(previous, signal);
			return await run();
		} finally {
			release!();
		}
	}

	private setBlocked(
		cellId: string,
		blockerId: string,
		active: boolean,
	): void {
		const blockers = this.blockers.get(cellId) ?? new Set<string>();
		const changed = active ? !blockers.has(blockerId) : blockers.delete(blockerId);
		if (active) blockers.add(blockerId);
		if (!changed) return;
		if (blockers.size === 0) this.blockers.delete(cellId);
		else this.blockers.set(cellId, blockers);
		this.cellContexts.get(cellId)?.setBlocked?.(blockerId, active);
		this.blockerChanges.get(cellId)?.resolve();
		this.blockerChanges.set(cellId, deferred());
	}

	private handleNotification(
		id: number,
		key: string,
		request: Extract<DelegateRequestMessage["request"], { type: "notification/send" }>,
	): void {
		const cellId = request.cellId;
		try {
			this.notifyDirect(cellId, request.text);
		} catch (error) {
			this.respond(id, {
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
			this.controllers.delete(key);
			return;
		}
		this.respond(id, {
			status: "ok",
			value: { type: "notification/delivered" },
		});
		this.controllers.delete(key);
	}

	private respond(id: number, result: Record<string, unknown>): void {
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
}

function numericSessionId(value: unknown): number | undefined {
	return value && typeof value === "object" && "session_id" in value && typeof value.session_id === "number"
		? value.session_id
		: undefined;
}

function hostControllerKey(id: number): string {
	return `host:${id}`;
}

function directControllerKey(cellId: string, requestId: number): string {
	return `direct:${cellId}:${requestId}`;
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function waitForChange(change: Promise<void>, signal?: AbortSignal): Promise<void> {
	if (!signal) return change;
	if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason ?? new Error("Operation aborted"));
		signal.addEventListener("abort", abort, { once: true });
		void change.then(
			() => {
				signal.removeEventListener("abort", abort);
				resolve();
			},
			(error: unknown) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
