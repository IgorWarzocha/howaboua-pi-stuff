import { formatCodeModeToolHelp } from "../code-mode/custom-tool-prompt.ts";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import {
	DEFAULT_CODE_MODE_EXEC_YIELD_MS,
	isCustomToolDefinition,
	parseExecSource,
} from "../code-mode/host-protocol.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import { codeModeNameForToolIdentity, resolveCodeModeToolIdentity } from "../code-mode/tool-identity.ts";
import type {
	CodeModeToolIdentity,
	CodeModeToolDefinition,
	NotebookMemoryUsage,
	RuntimeResponse,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import { NotebookBridgeServer } from "./bridge-server.ts";
import { NotebookCell } from "./cell.ts";
import { beginNotebookJournalCell, finishNotebookJournalCell } from "./journal.ts";
import { NOTEBOOK_INTERRUPTED_NOTICE } from "./runtime-health.ts";
import type { NotebookSessionRuntime } from "./session-runtime.ts";

const CANCEL_GRACE_MS = 250;
const TERMINATE_GRACE_MS = 1_500;

export class NotebookExecutionRuntime {
	readonly bridge: NotebookBridgeServer;
	private readonly session: () => NotebookSessionRuntime;
	private readonly prepareSession: (context: ToolExecutionContext, signal?: AbortSignal) => Promise<void>;
	private readonly delegate = new CodeModeDelegateRuntime(() => undefined);
	private readonly stopOperations = new WeakMap<NotebookCell, Promise<void>>();
	private activeCell: NotebookCell | undefined;
	private nextCellId = 1;

	constructor(
		session: () => NotebookSessionRuntime,
		prepareSession: (context: ToolExecutionContext, signal?: AbortSignal) => Promise<void>,
	) {
		this.session = session;
		this.prepareSession = prepareSession;
		this.bridge = new NotebookBridgeServer({
			callTool: (cellId, requestId, toolName, input) => this.callTool(cellId, requestId, toolName, input),
			cancelTools: (cellId) => this.cancelTools(cellId),
			emit: (cellId, items) => this.requireActiveCell(cellId).emit(items),
			notify: (cellId, text) => this.notify(cellId, text),
			yield: (cellId) => this.requireActiveCell(cellId).requestYield(),
			memory: (cellId, usage) => this.recordMemory(cellId, usage),
		});
	}

	activeCellId(): string | undefined { return this.activeCell?.id; }
	runningCellId(): string | undefined {
		return this.activeCell && !this.activeCell.result ? this.activeCell.id : undefined;
	}

	async execute(
		source: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
		tools: CodeModeToolDefinition[] = [],
	): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		if (this.activeCell) {
			throw new Error(`Notebook exec cell "${this.activeCell.id}" is still active; call wait or terminate it before starting another cell`);
		}
		const session = this.session();
		await this.prepareSession(context, signal);
		await session.checkpoints.flush();
		const { code, yieldTimeMs, maxOutputTokens } = parseExecSource(source);
		const effectiveYieldTime = directToolYieldTime(code, tools) ?? yieldTimeMs ?? DEFAULT_CODE_MODE_EXEC_YIELD_MS;
		this.nextCellId = Math.max(this.nextCellId, (session.journal()?.cells ?? 0) + 1);
		const id = `notebook-${this.nextCellId++}`;
		session.recordMemory(undefined);
		const cell = new NotebookCell({
			id,
			source: code,
			context,
			maxOutputTokens: maxOutputTokens ?? 10_000,
		});
		const notice = session.takeNotice();
		this.activeCell = cell;
		if (notice) cell.emit([{ type: "input_text", text: notice }]);
		this.delegate.bindCell(id, context, new Map(tools.map((tool) => [tool.name, tool])));
		let journaled = false;
		const journal = session.journal();
		if (journal) {
			try {
				beginNotebookJournalCell(journal, { id, source: cell.source });
				journaled = true;
			} catch (error) {
				this.reportJournalFailure(error, "start", cell);
			}
		}
		const metadata = tools
			.filter((tool) => isCustomToolDefinition(tool) && tool.deferLoading)
			.map((tool) => ({ name: tool.name, description: formatCodeModeToolHelp(tool) }));
		const toolNames = Object.fromEntries(tools.map((tool) => [tool.name, resolveCodeModeToolIdentity(tool)]));
		const wrapped = [
			`if (typeof globalThis.__piNotebook?.begin !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.begin");`,
			`await globalThis.__piNotebook.begin(${JSON.stringify(id)}, ${JSON.stringify(metadata)}, ${JSON.stringify(toolNames)});`,
			code,
			`if (typeof globalThis.__piNotebook?.flush !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.flush");`,
			`await globalThis.__piNotebook.flush(${JSON.stringify(id)});`,
			"undefined;",
		].join("\n");
		const abort = () => {
			cell.controller.abort();
			void this.stopAndCloseCell(cell).catch(() => undefined);
		};
		signal?.addEventListener("abort", abort, { once: true });
		void this.runCell(cell, wrapped, journaled).finally(() => signal?.removeEventListener("abort", abort));
		try {
			return await this.observe(cell, effectiveYieldTime, signal);
		} catch (error) {
			if (signal?.aborted) await this.stopAndCloseCell(cell).catch(() => undefined);
			throw error;
		}
	}

	async wait(
		cellId: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		const cell = this.activeCell;
		if (!cell || cell.id !== cellId) return this.withMemory({ kind: "result", cellId, contentItems: [], missingCell: true });
		cell.context = context;
		this.delegate.updateCellContext(cellId, context);
		return this.observe(cell, yieldTimeMs, signal);
	}

	async terminate(
		cellId: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		const cell = this.activeCell;
		if (!cell || cell.id !== cellId) return this.withMemory({ kind: "terminated", cellId, contentItems: [], missingCell: true });
		cell.context = context;
		this.delegate.updateCellContext(cellId, context);
		await this.stopCell(cell);
		return this.finishObservation(cell, "terminated");
	}

	async stopActive(): Promise<string | undefined> {
		const cell = this.activeCell;
		if (!cell) return undefined;
		await this.stopCell(cell);
		this.closeCell(cell);
		return cell.id;
	}

	clear(): void {
		this.activeCell = undefined;
		this.delegate.clear();
		this.session().recordMemory(undefined);
	}

	private async runCell(cell: NotebookCell, source: string, journaled: boolean): Promise<void> {
		const session = this.session();
		try {
			const result = await session.kernel()!.execute(source, {
				signal: cell.controller.signal,
				interruptOnAbort: false,
				onOutput: (item) => cell.emit([item]),
			});
			const normalized = result.errorName === "PiNotebookExit" && result.errorValue === this.bridge.exitToken
				? { ...result, status: "ok" as const, errorText: undefined, errorName: undefined, errorValue: undefined }
				: result;
			cell.result = normalized;
			if (!(await session.recoverFromBootstrapFailure(normalized))) {
				await this.endCellRuntime(cell);
				if (cell.result.status === "ok") {
					await session.recordNpmImports(cell.source);
					session.checkpoints.schedule();
				}
			}
		} catch (error) {
			this.delegate.cancelCell(cell.id);
			const recovery = cell.controller.signal.aborted ? undefined : await this.recoverAfterFatal(cell.context);
			cell.result = {
				status: cell.controller.signal.aborted ? "aborted" : "error",
				items: [],
				errorText: `${error instanceof Error ? error.message : String(error)}${recovery ? `\n${recovery}` : ""}`,
			};
		} finally {
			const journal = session.journal();
			if (cell.result && journal) {
				try {
					finishNotebookJournalCell(journal, {
						id: cell.id,
						source: cell.source,
						items: cell.items,
						result: cell.result,
					});
				} catch (error) {
					this.reportJournalFailure(error, journaled ? "completion" : "update", cell);
				}
			}
			cell.markCompleted();
		}
	}

	private async endCellRuntime(cell: NotebookCell): Promise<void> {
		const kernel = this.session().kernel();
		if (!kernel) return;
		const id = JSON.stringify(cell.id);
		const result = await kernel.execute(`if (typeof globalThis.__piNotebook?.finish !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.finish"); await globalThis.__piNotebook.finish(${id}); undefined;`);
		await this.session().recoverFromBootstrapFailure(result);
		if (result.status !== "ok" && cell.result?.status === "ok") {
			cell.result = { status: "error", items: [], errorText: result.errorText ?? "Notebook helper flush failed" };
		}
	}

	private async observe(cell: NotebookCell, yieldTimeMs: number, signal?: AbortSignal): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		return this.finishObservation(cell, await cell.observe(yieldTimeMs, signal));
	}

	private finishObservation(cell: NotebookCell, kind: RuntimeResponse["kind"]): RuntimeResponse {
		const notice = this.session().takeNotice();
		if (notice) cell.emit([{ type: "input_text", text: notice }]);
		const contentItems = cell.takeContent();
		const response: RuntimeResponse = kind === "result"
			? {
				kind,
				cellId: cell.id,
				contentItems,
				...(cell.result?.status === "error" && cell.result.errorText ? { errorText: cell.result.errorText } : {}),
				maxOutputTokens: cell.maxOutputTokens,
			}
			: kind === "terminated"
				? { kind, cellId: cell.id, contentItems }
				: { kind, cellId: cell.id, contentItems, maxOutputTokens: cell.maxOutputTokens };
		const attached = this.delegate.attach(this.withMemory(response));
		if (kind !== "yielded") this.closeCell(cell);
		return attached;
	}

	private stopCell(cell: NotebookCell): Promise<void> {
		const existing = this.stopOperations.get(cell);
		if (existing) return existing;
		const operation = this.stopCellInner(cell).finally(() => this.stopOperations.delete(cell));
		this.stopOperations.set(cell, operation);
		return operation;
	}

	private async stopCellInner(cell: NotebookCell): Promise<void> {
		const isolateKernel = !cell.isCompleted();
		cell.terminated = true;
		cell.controller.abort();
		this.delegate.cancelCell(cell.id);
		await Promise.race([cell.waitForCompletion(), delay(CANCEL_GRACE_MS)]);
		if (!cell.isCompleted()) {
			const kernel = this.session().kernel();
			try { await kernel?.interrupt(); } catch {}
		}
		if (isolateKernel) await this.session().invalidateKernel(NOTEBOOK_INTERRUPTED_NOTICE);
		await Promise.race([cell.waitForCompletion(), delay(TERMINATE_GRACE_MS)]);
		if (!cell.isCompleted()) {
			cell.result = { status: "aborted", items: [] };
			cell.markCompleted();
		}
	}

	private async stopAndCloseCell(cell: NotebookCell): Promise<void> {
		await this.stopCell(cell);
		this.closeCell(cell);
	}

	private async recoverAfterFatal(context: ToolExecutionContext): Promise<string> {
		const extension = context.extensionContext;
		if (!extension) return "Notebook kernel could not restart because its session context is unavailable";
		if (this.activeCell) this.delegate.cancelCell(this.activeCell.id);
		try {
			const restoreNotice = await this.session().restart(extension);
			return `Notebook kernel restarted from the last completed checkpoint; external side effects were not rolled back${restoreNotice ? `. ${restoreNotice}` : ""}`;
		} catch (error) {
			return `Notebook kernel restart failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	private reportJournalFailure(error: unknown, operation: string, cell: NotebookCell): void {
		cell.emit([{ type: "input_text", text: `Notebook journal ${operation} failed: ${error instanceof Error ? error.message : String(error)}` }]);
	}

	private closeCell(cell: NotebookCell): void {
		if (this.activeCell === cell) this.activeCell = undefined;
		this.delegate.closeCell(cell.id);
	}

	private async callTool(cellId: string, requestId: number, toolName: CodeModeToolIdentity, input: unknown): Promise<unknown> {
		this.requireActiveCell(cellId);
		return this.delegate.invokeDirect(cellId, requestId, codeModeNameForToolIdentity(toolName), input);
	}

	private cancelTools(cellId: string): void {
		this.requireActiveCell(cellId);
		this.delegate.cancelCell(cellId);
	}

	private notify(cellId: string, text: string): void {
		this.requireActiveCell(cellId);
		this.delegate.notifyDirect(cellId, text);
	}

	private recordMemory(cellId: string, usage: NotebookMemoryUsage): void {
		if (this.activeCell?.id === cellId) this.session().recordMemory(usage);
	}

	private withMemory(response: RuntimeResponse): RuntimeResponse {
		const memory = this.session().memory();
		return memory ? { ...response, notebookMemory: memory } : response;
	}

	private requireActiveCell(cellId: string): NotebookCell {
		const cell = this.activeCell;
		if (!cell || cell.id !== cellId) throw new Error(`Notebook cell "${cellId}" is not active`);
		return cell;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
