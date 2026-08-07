import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatCodeModeToolHelp } from "../code-mode/custom-tool-prompt.ts";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import {
	DEFAULT_CODE_MODE_EXEC_YIELD_MS,
	isCustomToolDefinition,
	parseExecSource,
} from "../code-mode/host-protocol.ts";
import type { CodeModeExecutionClient } from "../code-mode/shared-runtime.ts";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import type {
	CodeModeToolDefinition,
	NotebookMemoryUsage,
	RuntimeResponse,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import { NotebookBridgeServer } from "./bridge-server.ts";
import { NotebookCell } from "./cell.ts";
import { resolveNotebookCheckpointMaxBytes } from "./checkpoint.ts";
import { NotebookCheckpointManager } from "./checkpoint-manager.ts";
import { DenoJupyterKernel } from "./jupyter-kernel.ts";
import {
	appendNotebookJournalCell,
	type NotebookJournal,
} from "./journal.ts";
import { resolveNotebookProject } from "./project-identity.ts";
import { startNotebookSession } from "./session-startup.ts";
import { notebookSessionIdentity } from "./session-identity.ts";

const TERMINATE_GRACE_MS = 1_500;
const MAX_NOTICE_CHARS = 16_384;

export class NotebookCodeModeClient implements CodeModeExecutionClient {
	private readonly options: NotebookRuntimeOptions;
	private readonly checkpointMaxBytes: number;
	private readonly checkpoints: NotebookCheckpointManager;
	private readonly delegate = new CodeModeDelegateRuntime(() => undefined);
	private readonly bridge = new NotebookBridgeServer({
		callTool: (cellId, requestId, tool, input) => this.callTool(cellId, requestId, tool, input),
		cancelTools: (cellId) => this.cancelTools(cellId),
		emit: (cellId, items) => this.requireActiveCell(cellId).emit(items),
		notify: (cellId, text) => this.notify(cellId, text),
		yield: (cellId) => this.requireActiveCell(cellId).requestYield(),
		memory: (cellId, usage) => this.recordMemory(cellId, usage),
	});
	private kernel: DenoJupyterKernel | undefined;
	private sessionIdentity: string | undefined;
	private activeCell: NotebookCell | undefined;
	private nextCellId = 1;
	private startup: Promise<void> | undefined;
	private startupAbort: AbortController | undefined;
	private pendingNotice: string | undefined;
	private latestMemory: NotebookMemoryUsage | undefined;
	private journal: NotebookJournal | undefined;
	private extensionContext: ExtensionContext | undefined;

	constructor(options: NotebookRuntimeOptions) {
		this.options = options;
		this.checkpointMaxBytes = resolveNotebookCheckpointMaxBytes(options.maxHeapMiB);
		this.checkpoints = new NotebookCheckpointManager({
			maxBytes: this.checkpointMaxBytes,
			currentKernel: () => this.kernel,
			runningCellId: () => this.activeCell && !this.activeCell.result ? this.activeCell.id : undefined,
			reportNotice: (notice, showInUi) => {
				this.pendingNotice = joinNotices(this.pendingNotice, notice);
				if (showInUi) this.extensionContext?.ui.notify(notice, "warning");
			},
		});
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
		await this.ensureSession(context, signal);
		await this.checkpoints.flush();
		const { code, yieldTimeMs, maxOutputTokens } = parseExecSource(source);
		const effectiveYieldTime = directToolYieldTime(code, tools) ?? yieldTimeMs ?? DEFAULT_CODE_MODE_EXEC_YIELD_MS;
		const id = `notebook-${this.nextCellId++}`;
		this.latestMemory = undefined;
		const cell = new NotebookCell({
			id,
			source: code,
			context,
			maxOutputTokens: maxOutputTokens ?? 10_000,
		});
		const notice = this.pendingNotice;
		this.pendingNotice = undefined;
		this.activeCell = cell;
		if (notice) cell.emit([{ type: "input_text", text: notice }]);
		this.delegate.bindCell(id, context, new Map(tools.map((tool) => [tool.name, tool])));
		const metadata = tools
			.filter((tool) => isCustomToolDefinition(tool) && tool.deferLoading)
			.map((tool) => ({ name: tool.name, description: formatCodeModeToolHelp(tool) }));
		const wrapped = [
			`await globalThis.__piNotebook.begin(${JSON.stringify(id)}, ${JSON.stringify(metadata)});`,
			code,
			`await globalThis.__piNotebook.flush(${JSON.stringify(id)});`,
			"undefined;",
		].join("\n");
		const abort = () => {
			cell.controller.abort();
			void this.stopCell(cell).catch(() => undefined);
		};
		signal?.addEventListener("abort", abort, { once: true });
		void this.runCell(cell, wrapped).finally(() => signal?.removeEventListener("abort", abort));
		try {
			return await this.observe(cell, effectiveYieldTime, signal);
		} catch (error) {
			if (signal?.aborted) await this.stopCell(cell).catch(() => undefined);
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
		if (!cell || cell.id !== cellId) {
			return this.withMemory({ kind: "result", cellId, contentItems: [], missingCell: true });
		}
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
		if (!cell || cell.id !== cellId) {
			return this.withMemory({ kind: "terminated", cellId, contentItems: [], missingCell: true });
		}
		cell.context = context;
		this.delegate.updateCellContext(cellId, context);
		await this.stopCell(cell);
		return this.finishObservation(cell, "terminated");
	}

	async checkpoint(): Promise<void> {
		await this.checkpoints.flush(true);
	}

	async shutdown(): Promise<void> {
		this.startupAbort?.abort(new Error("Notebook session is shutting down"));
		await this.startup?.catch(() => undefined);
		const active = this.activeCell;
		if (active) await this.stopCell(active).catch(() => undefined);
		await this.checkpoints.flush();
		if (active) this.closeCell(active);
		this.activeCell = undefined;
		this.startup = undefined;
		this.startupAbort = undefined;
		this.sessionIdentity = undefined;
		this.checkpoints.reset();
		this.pendingNotice = undefined;
		this.latestMemory = undefined;
		this.journal = undefined;
		this.extensionContext = undefined;
		const kernel = this.kernel;
		this.kernel = undefined;
		this.delegate.clear();
		await kernel?.shutdown().catch(() => undefined);
		await this.bridge.shutdown();
	}

	private async ensureSession(context: ToolExecutionContext, signal?: AbortSignal): Promise<void> {
		const extension = context.extensionContext;
		if (!extension) throw new Error("Notebook Code Mode requires an extension session context");
		this.extensionContext = extension;
		const identity = `${notebookSessionIdentity(extension)}\0${resolveNotebookProject(extension.cwd)}`;
		if (this.sessionIdentity && this.sessionIdentity !== identity) await this.shutdown();
		if (!this.startup) {
			this.sessionIdentity = identity;
			const startupAbort = new AbortController();
			const startupSignal = signal
				? AbortSignal.any([signal, startupAbort.signal])
				: startupAbort.signal;
			this.startupAbort = startupAbort;
			const pending = this.startSession(extension, startupSignal)
				.catch((error) => {
					if (this.startup === pending) this.startup = undefined;
					throw error;
				})
				.finally(() => {
					if (this.startupAbort === startupAbort) this.startupAbort = undefined;
				});
			this.startup = pending;
		}
		await this.startup;
	}

	private async startSession(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
		this.latestMemory = undefined;
		const started = await startNotebookSession({
			context: ctx,
			runtime: this.options,
			bridge: this.bridge,
			checkpointMaxBytes: this.checkpointMaxBytes,
			...(signal ? { signal } : {}),
		});
		this.kernel = started.kernel;
		this.journal = started.journal;
		this.checkpoints.configure(started.checkpointIdentity, started.baselineNames);
		this.reportStateNotice(started.restoreNotice);
	}

	private async runCell(cell: NotebookCell, source: string): Promise<void> {
		try {
			const result = await this.kernel!.execute(source, {
				signal: cell.controller.signal,
				onOutput: (item) => cell.emit([item]),
			});
			const normalized = result.errorName === "PiNotebookExit" && result.errorValue === this.bridge.exitToken
				? { ...result, status: "ok" as const, errorText: undefined, errorName: undefined, errorValue: undefined }
				: result;
			cell.result = normalized;
			await this.endCellRuntime(cell);
			if (cell.result.status === "ok") this.checkpoints.schedule();
		} catch (error) {
			this.delegate.cancelCell(cell.id);
			const recovery = cell.controller.signal.aborted
				? undefined
				: await this.recoverAfterFatal(cell.context);
			cell.result = {
				status: cell.controller.signal.aborted ? "aborted" : "error",
				items: [],
				errorText: `${error instanceof Error ? error.message : String(error)}${recovery ? `\n${recovery}` : ""}`,
			};
		} finally {
			if (cell.result && this.journal) {
				try {
					appendNotebookJournalCell(this.journal, {
						id: cell.id,
						source: cell.source,
						items: cell.items,
						result: cell.result,
					});
				} catch (error) {
					const notice = `Notebook journal update failed: ${error instanceof Error ? error.message : String(error)}`;
					this.pendingNotice = joinNotices(
						this.pendingNotice,
						notice,
					);
					this.extensionContext?.ui.notify(notice, "warning");
				}
			}
			cell.markCompleted();
		}
	}

	private async endCellRuntime(cell: NotebookCell): Promise<void> {
		if (!this.kernel) return;
		const id = JSON.stringify(cell.id);
		const result = await this.kernel.execute(`await globalThis.__piNotebook.flush(${id}); globalThis.__piNotebook.end(${id}); undefined;`);
		if (result.status !== "ok" && cell.result?.status === "ok") {
			cell.result = { status: "error", items: [], errorText: result.errorText ?? "Notebook helper flush failed" };
		}
	}

	private async observe(cell: NotebookCell, yieldTimeMs: number, signal?: AbortSignal): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		return this.finishObservation(cell, await cell.observe(yieldTimeMs, signal));
	}

	private finishObservation(cell: NotebookCell, kind: RuntimeResponse["kind"]): RuntimeResponse {
		const notice = this.pendingNotice;
		this.pendingNotice = undefined;
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

	private async stopCell(cell: NotebookCell): Promise<void> {
		if (cell.terminated) return;
		cell.terminated = true;
		cell.controller.abort();
		this.delegate.cancelCell(cell.id);
		await this.kernel?.interrupt().catch(() => undefined);
		await Promise.race([cell.waitForCompletion(), abortableDelay(TERMINATE_GRACE_MS)]);
		if (!cell.result) {
			const kernel = this.kernel;
			this.kernel = undefined;
			this.startup = undefined;
			await kernel?.shutdown().catch(() => undefined);
			cell.result = { status: "aborted", items: [] };
			cell.markCompleted();
		}
	}

	private async recoverAfterFatal(context: ToolExecutionContext): Promise<string> {
		const extension = context.extensionContext;
		if (!extension) return "Notebook kernel could not restart because its session context is unavailable";
		const previous = this.kernel;
		if (this.activeCell) this.delegate.cancelCell(this.activeCell.id);
		this.kernel = undefined;
		this.startup = undefined;
		await previous?.shutdown().catch(() => undefined);
		const pending = this.startSession(extension).catch((error) => {
			if (this.startup === pending) this.startup = undefined;
			throw error;
		});
		this.startup = pending;
		try {
			await pending;
			const restoreNotice = this.pendingNotice;
			this.pendingNotice = undefined;
			return `Notebook kernel restarted from the last completed checkpoint; external side effects were not rolled back${restoreNotice ? `. ${restoreNotice}` : ""}`;
		} catch (error) {
			return `Notebook kernel restart failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	private reportStateNotice(notice: string | undefined): void {
		if (!notice) return;
		try {
			this.options.reportStateNotice?.(notice);
		} catch {
			// State reporting must not turn successful persistence into a cell failure.
		}
	}

	private closeCell(cell: NotebookCell): void {
		if (this.activeCell === cell) this.activeCell = undefined;
		this.delegate.closeCell(cell.id);
	}

	private async callTool(cellId: string, requestId: number, tool: string, input: unknown): Promise<unknown> {
		this.requireActiveCell(cellId);
		return this.delegate.invokeDirect(cellId, requestId, tool, input);
	}

	private cancelTools(cellId: string): void {
		this.requireActiveCell(cellId);
		this.delegate.cancelCell(cellId);
	}
	private notify(cellId: string, text: string): void {
		this.requireActiveCell(cellId);
		this.delegate.notifyDirect(cellId, text);
	}

	private recordMemory(
		cellId: string,
		usage: NotebookMemoryUsage,
	): void {
		if (this.activeCell?.id !== cellId) return;
		this.latestMemory = usage;
	}

	private withMemory(response: RuntimeResponse): RuntimeResponse {
		return this.latestMemory ? { ...response, notebookMemory: this.latestMemory } : response;
	}

	private requireActiveCell(cellId: string): NotebookCell {
		const cell = this.activeCell;
		if (!cell || cell.id !== cellId) throw new Error(`Notebook cell "${cellId}" is not active`);
		return cell;
	}
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(finish, Math.max(0, ms));
		const abort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			reject(signal?.reason ?? new Error("Operation aborted"));
		};
		function finish() {
			signal?.removeEventListener("abort", abort);
			resolve();
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function joinNotices(...notices: Array<string | undefined>): string | undefined {
	const present = notices.filter((notice): notice is string => Boolean(notice));
	if (present.length === 0) return undefined;
	const marker = " [Notebook notices truncated]";
	let output = "";
	for (let index = 0; index < present.length; index += 1) {
		const notice = present[index]!;
		const separator = output ? ". " : "";
		const remaining = MAX_NOTICE_CHARS - output.length - separator.length;
		if (remaining <= 0 || notice.length > remaining || index < present.length - 1 && notice.length === remaining) {
			return `${output}${separator}${notice.slice(0, Math.max(0, remaining - marker.length))}${marker}`.slice(0, MAX_NOTICE_CHARS);
		}
		output += separator + notice;
	}
	return output;
}
