import { runCustomTool } from "./custom-tool-runner.js";
import { isCustomToolDefinition, type DelegateRequestMessage } from "./host-protocol.js";
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

type SendMessage = (message: unknown) => void;

export class CodeModeDelegateRuntime {
	private readonly cellContexts = new Map<string, ToolExecutionContext>();
	private readonly cellTools = new Map<string, Map<string, CodeModeToolDefinition>>();
	private readonly controllers = new Map<number, AbortController>();
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
		for (const controller of this.controllers.values()) controller.abort();
		this.controllers.clear();
		this.cellContexts.clear();
		this.cellTools.clear();
		this.traces.clear();
		this.notifications.clear();
		for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
		this.cleanupTimers.clear();
	}

	cancel(id: number): void {
		const controller = this.controllers.get(id);
		this.controllers.delete(id);
		controller?.abort();
	}

	handleRequest(message: DelegateRequestMessage): void {
		if (this.controllers.has(message.id))
			throw new Error(`Duplicate code-mode delegate request: ${message.id}`);
		const controller = new AbortController();
		this.controllers.set(message.id, controller);
		void this.invoke(message, controller);
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
		controller: AbortController,
	): Promise<void> {
		const request = message.request;
		if (request.type === "notification/send") {
			this.handleNotification(message.id, request);
			return;
		}
		const invocation = request.invocation;
		const cellId = invocation.cell_id;
		const toolName = invocation.tool_name.name;
		const input = invocation?.input;
		const tool = this.cellTools.get(cellId)?.get(toolName);
		const context = this.cellContexts.get(cellId);
		if (!tool || !context) {
			this.respond(message.id, {
				status: "error",
				message: !tool
					? `Unknown custom tool: ${toolName}`
					: "Code-mode cell context is unavailable",
			});
			this.controllers.delete(message.id);
			return;
		}
		const trace = this.traces.start(
			cellId,
			String(invocation?.runtime_tool_call_id ?? message.id),
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
			if (isCustomToolDefinition(tool)) this.traces.emitUpdate(cellId, context);
			const result = isCustomToolDefinition(tool)
				? await runCustomTool(
						tool,
							input,
						invocationContext.cwd,
						controller.signal,
					)
				: await tool.invoke(
							input,
						invocationContext,
						controller.signal,
					);
			if (!trace.result)
				trace.result = this.traces.captureResult(
					cellId,
					trace,
					toolResultFromValue(result),
				);
			trace.status = "done";
			this.traces.emitUpdate(cellId, context);
			this.respond(message.id, {
				status: "ok",
				value: { type: "tool/result", result },
			});
		} catch (error) {
			trace.status = "error";
			trace.error = truncateTraceText(
				error instanceof Error ? error.message : String(error),
				MAX_TRACE_ERROR_CHARS,
			);
			this.traces.emitUpdate(cellId, context);
			this.respond(message.id, {
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.controllers.delete(message.id);
		}
	}

	private handleNotification(
		id: number,
		request: Extract<DelegateRequestMessage["request"], { type: "notification/send" }>,
	): void {
		const cellId = request.cellId;
		const context = this.cellContexts.get(cellId);
		if (!context) {
			this.respond(id, {
				status: "error",
				message: "Code-mode notification cell is unavailable",
			});
			this.controllers.delete(id);
			return;
		}
		const notifications = this.notifications.get(cellId) ?? [];
		const text = request.text.slice(0, MAX_NOTIFICATION_CHARS);
		notifications.push(text);
		if (notifications.length > MAX_NOTIFICATIONS_PER_CELL)
			notifications.splice(0, notifications.length - MAX_NOTIFICATIONS_PER_CELL);
		this.notifications.set(cellId, notifications);
		context.onUpdate?.({
			content: [{ type: "text", text }],
			details: { cellId, notification: true },
		});
		this.respond(id, {
			status: "ok",
			value: { type: "notification/delivered" },
		});
		this.controllers.delete(id);
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
