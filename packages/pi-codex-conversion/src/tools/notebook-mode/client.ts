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
	RuntimeContentItem,
	RuntimeResponse,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import { NotebookBridgeServer, notebookBootstrapSource } from "./bridge-server.ts";
import {
	formatCheckpointNotice,
	garbageCollectSupersededNotebookCheckpoints,
	resolveNotebookCheckpointMaxBytes,
	restoreNotebookCheckpoint,
	type NotebookCheckpointIdentity,
	writeNotebookCheckpoint,
} from "./checkpoint.ts";
import { ensureNotebookDenoBinary } from "./deno-binary.ts";
import { DenoJupyterKernel, type KernelExecutionResult } from "./jupyter-kernel.ts";
import {
	appendNotebookJournalCell,
	initializeNotebookJournal,
	type NotebookJournal,
	notebookJournalBootstrapSource,
} from "./journal.ts";
import { resolveNotebookProject } from "./project-identity.ts";
import {
	formatRepositoryStateNotice,
	repositoryConflictDirectory,
	restoreRepositoryState,
	type RepositoryStateBaseline,
	writeRepositoryState,
} from "./repository-state.ts";
import { notebookSessionIdentity } from "./session-identity.ts";

const TERMINATE_GRACE_MS = 1_500;
const CHECKPOINT_DEBOUNCE_MS = 1_500;
const MAX_CELL_OUTPUT_CHARS = 32 * 1024 * 1024;
const MAX_CELL_OUTPUT_ITEMS = 10_000;
const MAX_NOTICE_CHARS = 16_384;

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

interface NotebookCell {
	id: string;
	source: string;
	context: ToolExecutionContext;
	controller: AbortController;
	items: RuntimeContentItem[];
	outputChars: number;
	outputTruncated: boolean;
	cursor: number;
	maxOutputTokens: number;
	yielded: Deferred;
	completed: Deferred;
	result?: KernelExecutionResult | undefined;
	terminated: boolean;
}

export class NotebookCodeModeClient implements CodeModeExecutionClient {
	private readonly options: NotebookRuntimeOptions;
	private readonly checkpointMaxBytes: number;
	private readonly delegate = new CodeModeDelegateRuntime(() => undefined);
	private readonly bridge = new NotebookBridgeServer({
		callTool: (cellId, requestId, tool, input) => this.callTool(cellId, requestId, tool, input),
		cancelTools: (cellId) => this.cancelTools(cellId),
		emit: (cellId, items) => this.emit(cellId, items),
		notify: (cellId, text) => this.notify(cellId, text),
		yield: (cellId) => this.requestYield(cellId),
		memory: (cellId, usage) => this.recordMemory(cellId, usage),
	});
	private kernel: DenoJupyterKernel | undefined;
	private sessionIdentity: string | undefined;
	private activeCell: NotebookCell | undefined;
	private nextCellId = 1;
	private startup: Promise<void> | undefined;
	private startupAbort: AbortController | undefined;
	private baselineNames = new Set<string>();
	private checkpointIdentity: NotebookCheckpointIdentity | undefined;
	private checkpointTimer: ReturnType<typeof setTimeout> | undefined;
	private checkpointDirty = false;
	private maintenance: Promise<void> = Promise.resolve();
	private pendingNotice: string | undefined;
	private latestMemory: NotebookMemoryUsage | undefined;
	private repositoryBaseline: RepositoryStateBaseline = { generation: "root", entries: [] };
	private journal: NotebookJournal | undefined;
	private extensionContext: ExtensionContext | undefined;

	constructor(options: NotebookRuntimeOptions) {
		this.options = options;
		this.checkpointMaxBytes = resolveNotebookCheckpointMaxBytes(options.maxHeapMiB);
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
		await this.flushCheckpoint();
		const { code, yieldTimeMs, maxOutputTokens } = parseExecSource(source);
		const effectiveYieldTime = directToolYieldTime(code, tools) ?? yieldTimeMs ?? DEFAULT_CODE_MODE_EXEC_YIELD_MS;
		const id = `notebook-${this.nextCellId++}`;
		this.latestMemory = undefined;
		const cell: NotebookCell = {
			id,
			source: code,
			context,
			controller: new AbortController(),
			items: [],
			outputChars: 0,
			outputTruncated: false,
			cursor: 0,
			maxOutputTokens: maxOutputTokens ?? 10_000,
			yielded: deferred(),
			completed: deferred(),
			terminated: false,
		};
		const notice = this.pendingNotice;
		this.pendingNotice = undefined;
		this.activeCell = cell;
		if (notice) this.emit(id, [{ type: "input_text", text: notice }]);
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
		await this.flushCheckpoint(true);
	}

	async shutdown(): Promise<void> {
		this.startupAbort?.abort(new Error("Notebook session is shutting down"));
		await this.startup?.catch(() => undefined);
		const active = this.activeCell;
		if (active) await this.stopCell(active).catch(() => undefined);
		await this.flushCheckpoint();
		if (active) this.closeCell(active);
		this.activeCell = undefined;
		if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
		this.checkpointTimer = undefined;
		this.startup = undefined;
		this.startupAbort = undefined;
		this.sessionIdentity = undefined;
		this.baselineNames.clear();
		this.checkpointIdentity = undefined;
		this.checkpointDirty = false;
		this.pendingNotice = undefined;
		this.latestMemory = undefined;
		this.repositoryBaseline = { generation: "root", entries: [] };
		this.journal = undefined;
		this.extensionContext = undefined;
		const kernel = this.kernel;
		this.kernel = undefined;
		this.delegate.clear();
		await kernel?.shutdown().catch(() => undefined);
		await this.bridge.shutdown();
		this.maintenance = Promise.resolve();
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
		const startupAbort = new AbortController();
		const startupSignal = signal ? AbortSignal.any([signal, startupAbort.signal]) : startupAbort.signal;
		const denoPending = ensureNotebookDenoBinary({ agentDir: this.options.agentDir }, startupSignal);
		const bridgePending = this.bridge.start();
		let deno: string;
		let origin: string;
		try {
			[deno, origin] = await Promise.all([denoPending, bridgePending]);
			startupSignal.throwIfAborted();
		} catch (error) {
			startupAbort.abort();
			await Promise.allSettled([denoPending, bridgePending]);
			await this.bridge.shutdown().catch(() => undefined);
			throw error;
		}
		const kernel = new DenoJupyterKernel({ deno, cwd: ctx.cwd, maxHeapMiB: this.options.maxHeapMiB });
		this.kernel = kernel;
		try {
			await kernel.start(signal);
			const bootstrap = await kernel.execute(notebookBootstrapSource(origin, this.bridge.token, this.bridge.exitToken), { signal });
			if (bootstrap.status !== "ok") {
				throw new Error(`Notebook bootstrap failed: ${bootstrap.errorText ?? "unknown error"}`);
			}
			const project = resolveNotebookProject(ctx.cwd);
			const checkpointIdentity = {
				project,
				session: notebookSessionIdentity(ctx),
				agentDir: this.options.agentDir,
			};
			this.journal = initializeNotebookJournal({
				...checkpointIdentity,
				conflictDirectory: repositoryConflictDirectory(project, this.options.agentDir),
			});
			const journalBootstrap = await kernel.execute(notebookJournalBootstrapSource(this.journal), { signal });
			if (journalBootstrap.status !== "ok") {
				throw new Error(`Notebook journal bootstrap failed: ${journalBootstrap.errorText ?? "unknown error"}`);
			}
			const repository = await restoreRepositoryState(kernel, {
				project,
				agentDir: this.options.agentDir,
				maxBytes: this.checkpointMaxBytes,
			});
			this.repositoryBaseline = repository.baseline;
			this.baselineNames = new Set(await kernel.complete("", 0));
			this.checkpointIdentity = checkpointIdentity;
			const restored = await restoreNotebookCheckpoint(kernel, this.checkpointIdentity, this.checkpointMaxBytes);
			garbageCollectSupersededNotebookCheckpoints(this.checkpointIdentity);
			this.pendingNotice = joinNotices(
				formatRepositoryStateNotice(repository, { inventory: true }),
				formatCheckpointNotice(restored),
			);
		} catch (error) {
			if (this.kernel === kernel) this.kernel = undefined;
			await kernel.shutdown().catch(() => undefined);
			await this.bridge.shutdown().catch(() => undefined);
			throw error;
		}
	}

	private async runCell(cell: NotebookCell, source: string): Promise<void> {
		try {
			const result = await this.kernel!.execute(source, {
				signal: cell.controller.signal,
				onOutput: (item) => this.emit(cell.id, [item]),
			});
			const normalized = result.errorName === "PiNotebookExit" && result.errorValue === this.bridge.exitToken
				? { ...result, status: "ok" as const, errorText: undefined, errorName: undefined, errorValue: undefined }
				: result;
			cell.result = normalized;
			await this.endCellRuntime(cell);
			if (cell.result.status === "ok") this.scheduleCheckpoint();
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
					appendNotebookJournalCell(this.journal, cell as NotebookCell & { result: KernelExecutionResult });
				} catch (error) {
					const notice = `Notebook journal update failed: ${error instanceof Error ? error.message : String(error)}`;
					this.pendingNotice = joinNotices(
						this.pendingNotice,
						notice,
					);
					this.extensionContext?.ui.notify(notice, "warning");
				}
			}
			cell.completed.resolve();
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
		if (!cell.result) {
			await Promise.race([
				cell.completed.promise,
				cell.yielded.promise,
				abortableDelay(yieldTimeMs, signal),
			]);
		}
		if (cell.result) return this.finishObservation(cell, "result");
		cell.yielded = deferred();
		return this.finishObservation(cell, "yielded");
	}

	private finishObservation(cell: NotebookCell, kind: RuntimeResponse["kind"]): RuntimeResponse {
		const notice = this.pendingNotice;
		this.pendingNotice = undefined;
		if (notice) this.emit(cell.id, [{ type: "input_text", text: notice }]);
		const contentItems = cell.items.slice(cell.cursor);
		cell.cursor = cell.items.length;
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
		await Promise.race([cell.completed.promise, abortableDelay(TERMINATE_GRACE_MS)]);
		if (!cell.result) {
			const kernel = this.kernel;
			this.kernel = undefined;
			this.startup = undefined;
			await kernel?.shutdown().catch(() => undefined);
			cell.result = { status: "aborted", items: [] };
			cell.completed.resolve();
		}
	}

	private scheduleCheckpoint(): void {
		this.checkpointDirty = true;
		if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
		this.checkpointTimer = setTimeout(() => {
			this.checkpointTimer = undefined;
			void this.flushCheckpoint();
		}, CHECKPOINT_DEBOUNCE_MS);
		this.checkpointTimer.unref?.();
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

	private flushCheckpoint(requireIdle = false): Promise<void> {
		if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
		this.checkpointTimer = undefined;
		const operation = this.maintenance.then(() => this.performCheckpoint(requireIdle));
		this.maintenance = operation.catch(() => undefined);
		return operation;
	}

	private async performCheckpoint(requireIdle: boolean): Promise<void> {
		if (this.activeCell && !this.activeCell.result) {
			if (!requireIdle) return;
			const notice = `Notebook checkpoint skipped because cell "${this.activeCell.id}" is still running; the last completed checkpoint remains available`;
			this.pendingNotice = joinNotices(this.pendingNotice, notice);
			throw new Error(notice);
		}
		if (!this.checkpointDirty || !this.kernel || !this.checkpointIdentity) return;
		this.checkpointDirty = false;
		const kernel = this.kernel;
		const identity = this.checkpointIdentity;
		const baseline = this.baselineNames;
		const notices = [this.pendingNotice];
		try {
			const repository = await writeRepositoryState(
				kernel,
				identity,
				this.repositoryBaseline,
				this.checkpointMaxBytes,
			);
			this.repositoryBaseline = repository.baseline;
			const notice = formatRepositoryStateNotice(repository);
			notices.push(notice);
			if (notice) this.extensionContext?.ui.notify(notice, "warning");
		} catch (error) {
			this.checkpointDirty = true;
			const notice = `Repository notebook checkpoint failed: ${error instanceof Error ? error.message : String(error)}`;
			notices.push(notice);
			this.extensionContext?.ui.notify(notice, "warning");
		}
		try {
			const manifest = await writeNotebookCheckpoint(kernel, identity, baseline, this.checkpointMaxBytes);
			if (manifest.skipped.length > 0) {
				const notice = formatSkippedCheckpointNotice(manifest.skipped);
				notices.push(notice);
				this.extensionContext?.ui.notify(notice, "warning");
			}
		} catch (error) {
			this.checkpointDirty = true;
			const notice = `Session notebook checkpoint failed: ${error instanceof Error ? error.message : String(error)}`;
			notices.push(notice);
			this.extensionContext?.ui.notify(notice, "warning");
		}
		this.pendingNotice = joinNotices(...notices);
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

	private emit(cellId: string, items: RuntimeContentItem[]): void {
		const cell = this.requireActiveCell(cellId);
		const accepted: RuntimeContentItem[] = [];
		for (const item of items) {
			if (cell.outputTruncated) break;
			const size = item.type === "input_text" ? item.text?.length ?? 0 : item.image_url?.length ?? 0;
			if (cell.items.length >= MAX_CELL_OUTPUT_ITEMS || cell.outputChars + size > MAX_CELL_OUTPUT_CHARS) {
				const notice = { type: "input_text" as const, text: "[Notebook cell output truncated]" };
				cell.items.push(notice);
				accepted.push(notice);
				cell.outputChars += notice.text.length;
				cell.outputTruncated = true;
				break;
			}
			cell.items.push(item);
			accepted.push(item);
			cell.outputChars += size;
		}
		const content: Array<
			| { type: "text"; text: string }
			| { type: "image"; mimeType: string; data: string }
		> = [];
		for (const item of accepted) {
			if (item.type === "input_text" && item.text) {
				content.push({ type: "text", text: item.text });
				continue;
			}
			const match = item.type === "input_image" && item.image_url?.match(/^data:([^;,]+);base64,(.+)$/s);
			if (match) content.push({ type: "image", mimeType: match[1]!, data: match[2]! });
		}
		if (content.length > 0) cell.context.onUpdate?.({ content, details: { cellId, status: "running" } });
	}

	private notify(cellId: string, text: string): void {
		this.requireActiveCell(cellId);
		this.delegate.notifyDirect(cellId, text);
	}

	private requestYield(cellId: string): void {
		const cell = this.requireActiveCell(cellId);
		cell.yielded.resolve();
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

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
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

function formatSkippedCheckpointNotice(skipped: Array<{ name: string; reason: string }>): string {
	const shown = skipped.slice(0, 12).map(({ name, reason }) => `${name.slice(0, 256)} (${reason})`).join(", ");
	return `Notebook checkpoint skipped state: ${shown}${skipped.length > 12 ? `, and ${skipped.length - 12} more` : ""}`;
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
