import { randomUUID } from "node:crypto";
import { CodeModeDelegateRuntime } from "./delegate-runtime.js";
import { CodeModeHostConnection } from "./host-connection.js";
import {
	DEFAULT_CODE_MODE_EXEC_YIELD_MS,
	executionCellId,
	type HostMessage,
	isMissingRuntimeOutcome,
	parseExecSource,
	parseRuntimeResponse,
	runtimeOutcome,
	toWireToolDefinition,
} from "./host-protocol.js";
import {
	directToolYieldTime,
	scopeAllToolsToDeferredCustom,
} from "./tool-source.js";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "./types.js";

export { scopeAllToolsToDeferredCustom } from "./tool-source.js";

const DEFAULT_SHUTDOWN_GRACE_MS = 250;

type HostClientOptions = {
	binary: string;
	tools: CodeModeToolDefinition[];
	shutdownGraceMs?: number | undefined;
};

export class CodeModeHostClient {
	private readonly tools: Map<string, CodeModeToolDefinition>;
	private readonly shutdownGraceMs: number;
	private readonly sessionId = randomUUID();
	private readonly connection: CodeModeHostConnection;
	private readonly delegateRuntime: CodeModeDelegateRuntime;
	private ready: Promise<void> | undefined;

	constructor(options: HostClientOptions) {
		this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
		this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
		this.connection = new CodeModeHostConnection({
			binary: options.binary,
			onMessage: (message) => this.handleMessage(message),
			onFailure: () => {
				this.delegateRuntime.clear();
				this.ready = undefined;
			},
		});
		this.delegateRuntime = new CodeModeDelegateRuntime((message) =>
			this.connection.send(message),
		);
	}

	async start(): Promise<void> {
		if (this.ready) return this.ready;
		const ready = this.startSession();
		this.ready = ready;
		try {
			await ready;
		} catch (error) {
			this.connection.close(
				error instanceof Error ? error : new Error(String(error)),
			);
			throw error;
		}
	}

	private async startSession(): Promise<void> {
		await this.connection.start();
		await this.connection.request({
			method: "session/open",
			sessionId: this.sessionId,
		});
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
		const effectiveYieldTimeMs =
			directToolYieldTime(code, tools) ??
			yieldTimeMs ??
			DEFAULT_CODE_MODE_EXEC_YIELD_MS;
		const runtimeSource = scopeAllToolsToDeferredCustom(code, tools);
		const id = this.connection.nextRequestId();
		const initial = this.connection.expectInitial(id);
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
					source: runtimeSource,
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
				this.connection.send({ type: "operation/cancel", id });
			} catch {
				// Host teardown is already authoritative.
			}
			this.connection.rejectOperation(id, error);
			if (cellId) void this.terminate(cellId, context).catch(() => undefined);
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
			this.connection.rejectOperation(id, toError(error));
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
		const id = this.connection.nextRequestId();
		const abort = this.operationAbort(id);
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
				...(isMissingRuntimeOutcome(value)
					? { missingCell: true as const }
					: {}),
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
		const id = this.connection.nextRequestId();
		const abort = this.operationAbort(id);
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
				throw new Error(
					"Code-mode host returned an invalid termination outcome",
				);
			return {
				...this.delegateRuntime.attach(parseRuntimeResponse(wrapped)),
				...(isMissingRuntimeOutcome(value)
					? { missingCell: true as const }
					: {}),
			};
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	async shutdown(): Promise<void> {
		if (!this.connection.running) return;
		try {
			await Promise.race([
				this.connection.request({
					method: "session/shutdown",
					sessionId: this.sessionId,
				}),
				shutdownDeadline(this.shutdownGraceMs),
			]);
		} catch {
			// Process teardown below is authoritative.
		}
		this.connection.close(new Error("Code-mode host shut down"));
	}

	private requestWithId(
		id: number,
		request: Record<string, unknown>,
		context?: ToolExecutionContext,
		tools?: Map<string, CodeModeToolDefinition>,
	): Promise<unknown> {
		return this.connection.requestWithId(id, request, (value) => {
			const cellId = executionCellId(value);
			if (cellId && context)
				this.delegateRuntime.bindCell(cellId, context, tools);
		});
	}

	private operationAbort(id: number): () => void {
		return () => {
			const error = abortError();
			try {
				this.connection.send({ type: "operation/cancel", id });
			} catch {
				// Host teardown is already authoritative.
			}
			this.connection.rejectOperation(id, error);
		};
	}

	private handleMessage(message: HostMessage): void {
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

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
