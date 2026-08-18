import { runCustomTool } from "./custom-tool-runner.js";
import { isCustomToolDefinition, type DelegateRequestMessage } from "./host-protocol.js";
import { runCodeModeToolPreflight } from "./nested-tool-preflight.js";
import { codeModeNameForToolIdentity } from "./tool-identity.ts";
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

type SendMessage = (message: unknown) => void;

export class CodeModeDelegateRuntime {
	private readonly traceRuntimeGeneration = crypto.randomUUID();
	private readonly cellContexts = new Map<string, ToolExecutionContext>();
	private readonly cellTools = new Map<string, Map<string, CodeModeToolDefinition>>();
	private readonly controllers = new Map<string, DelegateController>();
	private readonly notifications = new Map<string, string[]>();
	private readonly traces = new CodeModeTraceStore();
	private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly send: SendMessage;

	constructor(send: SendMessage) {
		this.send = send;
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
		this.notifications.clear();
		for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
		this.cleanupTimers.clear();
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
		const trace = this.traces.start(
			cellId,
			`${this.traceRuntimeGeneration}:${cellId}:${traceId}`,
			tool.name,
			input,
		);
		const invocationContext: ToolExecutionContext = {
			...context,
			toolCallId: trace.id,
			onUpdate: (update) => {
				trace.result = this.traces.captureResult(cellId, trace, update);
				this.traces.emitUpdate(cellId, context);
			},
			captureResult: (result) => {
				trace.result = this.traces.captureResult(cellId, trace, result);
				this.traces.emitUpdate(cellId, context);
			},
			refreshTrace: () => this.traces.emitUpdate(cellId, context),
		};
		try {
			await runCodeModeToolPreflight(
				tool.name,
				input,
				invocationContext,
				controller.signal,
			);
			if (isCustomToolDefinition(tool)) this.traces.emitUpdate(cellId, context);
			controller.signal.throwIfAborted();
			const result = isCustomToolDefinition(tool)
				? await runCustomTool(tool, input, invocationContext.cwd, controller.signal)
				: await tool.invoke(input, invocationContext, controller.signal);
			if (!trace.result)
				trace.result = this.traces.captureResult(cellId, trace, toolResultFromValue(result));
			trace.status = "done";
			this.traces.emitUpdate(cellId, context);
			return result;
		} catch (error) {
			trace.status = "error";
			trace.error = truncateTraceText(
				error instanceof Error ? error.message : String(error),
				MAX_TRACE_ERROR_CHARS,
			);
			this.traces.emitUpdate(cellId, context);
			throw error;
		}
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
