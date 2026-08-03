import { CodeModeHostCellOperations } from "./host-cell-operations.js";
import { CodeModeHostDelegation } from "./host-delegation.js";
import {
	abortError,
	cancelOperation,
	throwIfAborted,
	toError,
} from "./host-operation.js";
import {
	DEFAULT_CODE_MODE_EXEC_YIELD_MS,
	executionCellId,
	parseExecSource,
	parseRuntimeResponse,
	toWireToolDefinition,
} from "./host-protocol.js";
import { CodeModeHostSession } from "./host-session.js";
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

type HostClientOptions = {
	binary: string;
	tools: CodeModeToolDefinition[];
	shutdownGraceMs?: number | undefined;
};

export class CodeModeHostClient {
	private readonly tools: Map<string, CodeModeToolDefinition>;
	private readonly session: CodeModeHostSession;
	private readonly delegation: CodeModeHostDelegation;
	private readonly cells: CodeModeHostCellOperations;

	constructor(options: HostClientOptions) {
		this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
		let session: CodeModeHostSession;
		this.delegation = new CodeModeHostDelegation((message) =>
			session.send(message),
		);
		session = new CodeModeHostSession({
			binary: options.binary,
			shutdownGraceMs: options.shutdownGraceMs,
			onMessage: (message) => this.delegation.handleMessage(message),
			onFailure: () => this.delegation.clear(),
		});
		this.session = session;
		this.cells = new CodeModeHostCellOperations(session, this.delegation);
	}

	async start(): Promise<void> {
		return this.session.start();
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
		const id = this.session.nextRequestId();
		const initial = this.session.expectInitial(id);
		void initial.catch(() => undefined);
		const toolSet = new Map(tools.map((tool) => [tool.name, tool]));
		const started = this.session.requestWithId(
			id,
			{
				method: "session/execute",
				sessionId: this.session.id,
				request: {
					tool_call_id: `exec-${id}`,
					enabled_tools: tools.map(toWireToolDefinition),
					source: scopeAllToolsToDeferredCustom(code, tools),
					yield_time_ms: effectiveYieldTimeMs,
					max_output_tokens: maxOutputTokens,
				},
			},
			(value) => this.delegation.bindResponse(value, context, toolSet),
		);
		let cellId: string | undefined;
		const abort = () => {
			cancelOperation(this.session, id);
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
				...this.delegation.attach(parseRuntimeResponse(await initial)),
				maxOutputTokens: maxOutputTokens ?? 10_000,
			};
		} catch (error) {
			this.session.rejectOperation(id, toError(error));
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
		return this.cells.wait(cellId, yieldTimeMs, context, signal);
	}

	async terminate(
		cellId: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		return this.cells.terminate(cellId, context, signal);
	}

	async shutdown(): Promise<void> {
		return this.session.shutdown();
	}
}
