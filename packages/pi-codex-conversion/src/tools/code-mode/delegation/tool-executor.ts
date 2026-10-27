import { runCustomTool } from "../custom-tool-runner.js";
import { mcpToolNamespaces, missingMcpToolMessage } from "../mcp-tool-recovery.js";
import { isCustomToolDefinition } from "../host-protocol.js";
import { runCodeModeToolWithHooks } from "../nested-tool-completion.js";
import type { CodeModeNestedRenderStore } from "../trace-render-state.js";
import type { CodeModeTraceStore } from "../trace-store.js";
import { toolResultFromValue, truncateTraceText } from "../trace-values.js";
import type { OpaqueToolOutput, RuntimeContentItem, ToolExecutionContext } from "../types.js";
import type { DelegateCellScheduling } from "./cell-scheduling.ts";
import { numericSessionId, type DelegateCellResults } from "./cell-results.ts";

const MAX_TRACE_ERROR_CHARS = 16_384;

export class DelegateToolExecutor {
	private readonly cells: DelegateCellScheduling;
	private readonly results: DelegateCellResults;
	private readonly traces: CodeModeTraceStore;
	private readonly renderStore: CodeModeNestedRenderStore;
	private readonly traceRuntimeGeneration: string;

	constructor(
		cells: DelegateCellScheduling,
		results: DelegateCellResults,
		traces: CodeModeTraceStore,
		renderStore: CodeModeNestedRenderStore,
		traceRuntimeGeneration: string,
	) {
		this.cells = cells;
		this.results = results;
		this.traces = traces;
		this.renderStore = renderStore;
		this.traceRuntimeGeneration = traceRuntimeGeneration;
	}

	async invoke(
		cellId: string,
		toolName: string,
		input: unknown,
		traceId: string,
		controller: AbortController,
	): Promise<unknown> {
		const tool = this.cells.tools(cellId)?.get(toolName);
		const context = this.cells.context(cellId);
		if (!tool) throw new Error(
			missingMcpToolMessage(toolName, mcpToolNamespaces(this.cells.tools(cellId)?.values() ?? []))
				?? `Unknown custom tool: ${toolName}`,
		);
		if (!context) throw new Error("Code-mode cell context is unavailable");
		const opaqueResult = !isCustomToolDefinition(tool) && tool.opaqueResult === true;
		const currentContext = () => this.cells.context(cellId) ?? context;
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
		if (captureRendererValues)
			this.renderStore.captureInput(trace.id, input);
		const invocationContext: ToolExecutionContext = {
			...context,
			originalExecCallId: this.results.originalExecCallId(cellId),
			toolCallId: trace.id,
			...(opaqueResult ? { captureOpaqueResult: (output: OpaqueToolOutput, images: RuntimeContentItem[]) => {
				this.results.reserveOpaqueCall(cellId);
				const pending = this.results.hasOpaqueResults(cellId);
				if (!pending || controller.signal.aborted ||
					this.cells.context(cellId)?.opaqueScope !== context.opaqueScope ||
					this.cells.context(cellId)?.opaqueContextGeneration !== context.opaqueContextGeneration)
					throw new Error("Remote operation executed but result delivery was cancelled; check completed results before retrying");
				this.results.captureOpaqueResult(cellId, output, images);
			} } : {}),
			...(!isCustomToolDefinition(tool) && tool.executionPipeline === "pi"
				? { preflight: undefined, completion: undefined }
				: {}),
			executeTool: async (name, args, options) => {
				const outcome = await this.cells.executePiTool(cellId, name, args, { ...options, signal: options?.signal ?? controller.signal });
				trace.nativeCallIds?.push(outcome.toolCall.id);
				return outcome;
			},
			onUpdate: (update) => {
				if (captureRendererValues)
					this.renderStore.captureResult(trace.id, update);
				trace.result = this.traces.captureResult(cellId, trace, update);
				emitTrace();
			},
			captureResult: (result) => {
				finalResultCaptured = true;
				if (!isCustomToolDefinition(tool) && tool.propagateTermination && result.terminate)
					this.results.markTerminating(cellId);
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
				if (!context.resolveOpaqueScope) {
					this.results.reserveOpaqueCall(cellId);
				}
			}
			blocking =
				!isCustomToolDefinition(tool) &&
				(tool.blocking === true || tool.isBlocking?.(input) === true);
			if (blocking) {
				blockerActive = true;
				trace.status = "blocked";
				this.cells.setBlocked(cellId, trace.id, true);
				emitTrace();
			}
			const invoke = async (hookContext: ToolExecutionContext) => {
				if (isCustomToolDefinition(tool)) emitTrace();
				controller.signal.throwIfAborted();
				const run = async (): Promise<unknown> => {
					return isCustomToolDefinition(tool)
						? await runCustomTool(tool, input, hookContext.cwd, controller.signal)
						: await tool.invoke(input, hookContext, controller.signal);
				};
				return !isCustomToolDefinition(tool) && tool.executionMode === "sequential"
					? await this.cells.invokeSequential(cellId, controller.signal, run)
					: await run();
			};
			const result = !isCustomToolDefinition(tool) && tool.executionPipeline === "adapter"
				? await invoke(invocationContext)
				: await runCodeModeToolWithHooks(tool.name, input, invocationContext, controller.signal, invoke);
			if (!trace.result)
				trace.result = this.traces.captureResult(cellId, trace, toolResultFromValue(result));
			trace.status = "done";
			this.results.recordExecSession(cellId, tool.name, input, finalResultCaptured ? resultSessionId : numericSessionId(result));
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
			if (blockerActive) this.cells.setBlocked(cellId, trace.id, false);
		}
	}
}
