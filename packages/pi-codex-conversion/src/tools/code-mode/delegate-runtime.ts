import { DelegateToolExecutor } from "./delegation/tool-executor.ts";
import type { prepareCodeModeToolInput } from "./tool-input.ts";
import { DelegateCellScheduling } from "./delegation/cell-scheduling.ts";
import { DelegateCellResults } from "./delegation/cell-results.ts";
import { type DelegateRequestMessage } from "./host-protocol.js";
import { codeModeNameForToolIdentity } from "./tool-identity.ts";
import { CodeModeNestedRenderStore } from "./trace-render-state.js";
import { CodeModeTraceStore } from "./trace-store.js";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "./types.js";


interface DelegateController {
	cellId?: string | undefined;
	controller: AbortController;
}

type SendMessage = (message: unknown) => void;

export class CodeModeDelegateRuntime {
	private readonly traceRuntimeGeneration = crypto.randomUUID();
	private readonly controllers = new Map<string, DelegateController>();
	private readonly traces = new CodeModeTraceStore();
	private readonly cells = new DelegateCellScheduling();
	private readonly results = new DelegateCellResults();
	private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly send: SendMessage;
	private readonly renderStore: CodeModeNestedRenderStore;
	private readonly executor: DelegateToolExecutor;

	constructor(
		send: SendMessage,
		prepareToolInput: typeof prepareCodeModeToolInput,
		renderStore = new CodeModeNestedRenderStore(),
	) {
		this.send = send;
		this.renderStore = renderStore;
		this.executor = new DelegateToolExecutor(prepareToolInput, this.cells, this.results, this.traces, renderStore, this.traceRuntimeGeneration);
	}

	bindCell(
		cellId: string,
		context: ToolExecutionContext,
		tools?: Map<string, CodeModeToolDefinition>,
	): void {
		this.updateCellContext(cellId, context);
		this.results.bindCell(cellId, context);
		if (tools) this.cells.bindTools(cellId, tools);
	}

	updateCellContext(cellId: string, context: ToolExecutionContext): void {
		this.cells.updateCellContext(cellId, context);
	}

	closeCell(cellId: string): void {
		this.cells.closeCell(cellId);
		const previous = this.cleanupTimers.get(cellId);
		if (previous) clearTimeout(previous);
		this.cleanupTimers.set(cellId, setTimeout(() => {
			this.cleanupTimers.delete(cellId);
			this.results.delete(cellId);
			this.traces.delete(cellId);
		}, 1_000));
	}

	clear(): void {
		for (const { controller } of this.controllers.values()) controller.abort();
		this.controllers.clear();
		this.cells.clear();
		this.traces.clear();
		this.renderStore.clear();
		this.clearOpaqueResults();
		this.results.clear();
		for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
		this.cleanupTimers.clear();
	}

	clearOpaqueResults(): void {
		for (const cellId of this.results.opaqueCellIds()) this.cancelCell(cellId);
		this.results.clearOpaqueResults();
	}

	isBlocked(cellId: string): boolean { return this.cells.isBlocked(cellId); }

	waitUntilUnblocked(cellId: string, signal?: AbortSignal): Promise<void> {
		return this.cells.waitUntilUnblocked(cellId, signal);
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
			return await this.executor.invoke(cellId, toolName, input, String(requestId), controller);
		} finally {
			this.controllers.delete(key);
		}
	}

	notifyDirect(cellId: string, value: string): void {
		this.results.notifyDirect(cellId, value, this.cells.context(cellId));
	}

	attach(response: RuntimeResponse): RuntimeResponse {
		const cleanupTimer = this.cleanupTimers.get(response.cellId);
		if (cleanupTimer) clearTimeout(cleanupTimer);
		this.cleanupTimers.delete(response.cellId);
		return this.results.attach(response, this.traces);
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
			const result = await this.executor.invoke(
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
