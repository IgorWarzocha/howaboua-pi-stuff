import { runCustomTool } from "./custom-tool-runner.js";
import { isCustomToolDefinition, type DelegateRequestMessage } from "./host-protocol.js";
import { runCodeModeToolPreflight } from "./nested-tool-preflight.js";
import { codeModeNameForToolIdentity } from "./tool-identity.ts";
import { CodeModeNestedRenderStore } from "./trace-render-state.js";
import { CodeModeTraceStore } from "./trace-store.js";
import { toolResultFromValue, truncateTraceText } from "./trace-values.js";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "./types.js";

const MAX_TRACE_ERROR_CHARS = 16_384;
const MAX_NOTIFICATION_CHARS = 16_384;
const MAX_NOTIFICATIONS_PER_CELL = 100;

interface DelegateController {
	cellId?: string | undefined;
	controller: AbortController;
}

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

type SendMessage = (message: unknown) => void;

export class CodeModeDelegateRuntime {
	private readonly traceRuntimeGeneration = crypto.randomUUID();
	private readonly cellContexts = new Map<string, ToolExecutionContext>();
	private readonly cellTools = new Map<string, Map<string, CodeModeToolDefinition>>();
	private readonly controllers = new Map<string, DelegateController>();
	private readonly notifications = new Map<string, string[]>();
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
		this.cellContexts.set(cellId, context);
		if (tools) this.cellTools.set(cellId, tools);
	}

	updateCellContext(cellId: string, context: ToolExecutionContext): void {
		this.cellContexts.set(cellId, context);
	}

	closeCell(cellId: string): void {
		this.cellContexts.delete(cellId);
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
			this.traces.delete(cellId);
		}, 1_000));
	}

	clear(): void {
		for (const { controller } of this.controllers.values()) controller.abort();
		this.controllers.clear();
		this.cellContexts.clear();
		this.cellTools.clear();
		this.traces.clear();
		this.renderStore.clear();
		this.notifications.clear();
		for (const change of this.blockerChanges.values()) change.resolve();
		this.blockers.clear();
		this.blockerChanges.clear();
		this.sequentialTails.clear();
		for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
		this.cleanupTimers.clear();
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
		const cleanupTimer = this.cleanupTimers.get(response.cellId);
		if (cleanupTimer) clearTimeout(cleanupTimer);
		this.cleanupTimers.delete(response.cellId);
		const notifications = this.notifications.get(response.cellId) ?? [];
		this.notifications.delete(response.cellId);
		const withTraces = this.traces.attach(response);
		if (notifications.length === 0) return withTraces;
		return {
			...withTraces,
			contentItems: [
				...notifications.map((text) => ({ type: "input_text" as const, text })),
				...response.contentItems,
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
		if (!tool) throw new Error(`Unknown custom tool: ${toolName}`);
		if (!context) throw new Error("Code-mode cell context is unavailable");
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
		if (captureRendererValues)
			this.renderStore.captureInput(trace.id, input);
		const invocationContext: ToolExecutionContext = {
			...context,
			toolCallId: trace.id,
			onUpdate: (update) => {
				if (captureRendererValues)
					this.renderStore.captureResult(trace.id, update);
				trace.result = this.traces.captureResult(cellId, trace, update);
				emitTrace();
			},
			captureResult: (result) => {
				finalResultCaptured = true;
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
			blocking =
				!isCustomToolDefinition(tool) &&
				(tool.blocking === true || tool.isBlocking?.(input) === true);
			if (blocking) {
				blockerActive = true;
				trace.status = "blocked";
				this.setBlocked(cellId, trace.id, true);
				emitTrace();
			}
			await runCodeModeToolPreflight(
				tool.name,
				input,
				invocationContext,
				controller.signal,
			);
			if (isCustomToolDefinition(tool)) emitTrace();
			controller.signal.throwIfAborted();
			const run = async (): Promise<unknown> => {
				return isCustomToolDefinition(tool)
					? await runCustomTool(tool, input, invocationContext.cwd, controller.signal)
					: await tool.invoke(input, invocationContext, controller.signal);
			};
			const result = !isCustomToolDefinition(tool) && tool.executionMode === "sequential"
				? await this.invokeSequential(cellId, controller.signal, run)
				: await run();
			if (!trace.result)
				trace.result = this.traces.captureResult(cellId, trace, toolResultFromValue(result));
			trace.status = "done";
			emitTrace();
			return result;
		} catch (error) {
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
