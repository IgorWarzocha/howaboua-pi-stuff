import { randomUUID } from "node:crypto";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import { DEFAULT_CODE_MODE_EXEC_YIELD_MS, parseExecSource } from "../code-mode/host-protocol.ts";
import type { CodeModeExecutionClient, NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type { CodeModeToolDefinition, NotebookControlRequest, NotebookControlResult, RuntimeResponse, ToolExecutionContext } from "../code-mode/types.ts";
import { NotebookCell } from "../notebook-mode/cell.ts";
import { notebookSessionIdentity } from "../notebook-mode/session-identity.ts";
import { formatSkipped, selectProjectPins, TsStateLifecycle } from "./lifecycle.ts";
import { bindingDependencies, compactState, emptyState, type BindingRecipe, type PortableCapture, type PortableState } from "./portable-state.ts";
import { TsStateStorage } from "./state-storage.ts";
import { TsSessionCompilation } from "./session-compilation.ts";
import { MAX_TS_WORKERS, TsSessionKernel, type TsExecution } from "./session-kernel.ts";

export class TsCodeModeClient implements CodeModeExecutionClient {
	private readonly options: NotebookRuntimeOptions;
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly lifecycle: TsStateLifecycle;
	private readonly compilation: TsSessionCompilation;
	private readonly kernel: TsSessionKernel;
	private readonly cells = new Map<string, TsExecution>();
	private state = emptyState();
	private durable = emptyState();
	private liveQueue: Promise<void> = Promise.resolve();
	private latestTools: CodeModeToolDefinition[] = [];
	private controlRequest: NotebookControlRequest | undefined;
	private observedProject = emptyState();
	private storage: TsStateStorage | undefined;
	private identity: string | undefined;
	private preparing: Promise<void> = Promise.resolve();
	private committing: Promise<void> = Promise.resolve();
	private nextId = 0;
	private generation = 0;
	private running = 0;
	private phase: "ready" | "closing" = "ready";
	private shutdownPromise: Promise<void> | undefined;

	constructor(options: NotebookRuntimeOptions, renderStore?: CodeModeNestedRenderStore) {
		if (!(((process.platform === "linux" || process.platform === "darwin") && (process.arch === "x64" || process.arch === "arm64")) || (process.platform === "win32" && process.arch === "x64"))) throw new Error(`TS is unavailable on ${process.platform}/${process.arch}; choose Code or Deno Notebook. TS supports Linux and macOS x64/arm64, and Windows x64.`);
		if (process.versions["bun"]) throw new Error("TS execution requires a Node.js Pi host; start Pi with Node.js. Code and Deno Notebook remain available.");
		if (!Number.isSafeInteger(options.maxHeapMiB) || options.maxHeapMiB < 128) throw new Error("TS requires a session heap budget of at least 128 MiB; increase the Notebook heap setting before selecting TS. Half is reserved for live execution and half for up to four isolated cells");
		this.options = options;
		this.delegate = new CodeModeDelegateRuntime(() => undefined, renderStore);
		this.compilation = new TsSessionCompilation(options);
		this.kernel = new TsSessionKernel(options);
		this.lifecycle = new TsStateLifecycle({
			state: () => this.state,
			capture: bindings => this.capture(bindings),
			validateCheckpoint: (name, checkpoint) => this.compilation.validateCheckpoint(this.state, name, checkpoint),
			storage: () => this.requireStorage(),
			activeCells: () => [...this.cells.values()].filter(execution => !execution.cell.isCompleted()).map(execution => execution.cell.id),
			commit: (state, action) => this.commitState(state, action),
			syncProject: () => this.syncProject(),
			restart: async () => { await this.resetKernel(this.durable); await this.compilation.closeCompiler(); },
			reset: async () => {
				const project = await this.requireStorage().readProject();
				await this.requireStorage().write(project);
				await this.resetKernel(project);
				this.durable = project;
				this.observedProject = project;
				await this.requireStorage().write(project, "observed-project");
			},
		});
	}

	async execute(source: string, context: ToolExecutionContext, signal?: AbortSignal, tools: CodeModeToolDefinition[] = []): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		await this.prepare(context);
		await this.committing;
		signal?.throwIfAborted();
		if (this.phase === "closing" || this.identity !== this.contextKey(context)) throw new Error("TS session changed before execution; start a new cell");
		if (this.running >= MAX_TS_WORKERS) throw new Error(`TS has ${MAX_TS_WORKERS} active cells; wait for or terminate one before starting another`);
		if (this.cells.size >= 32) throw new Error("TS has 32 uncollected cell results; use wait to collect completed results before starting another cell");
		const parsed = parseExecSource(source, { allowIsolated: true });
		const isolated = parsed.isolated === true;
		if (!isolated && this.kernel.unavailable) throw new Error("The TS live kernel stopped. Use notebook restart to restore its last durable checkpoint; live-only values and later changes cannot be recovered");
		this.latestTools = tools;
		const cell = new NotebookCell({ id: `ts-${++this.nextId}-${randomUUID().slice(0, 8)}`, source: parsed.code, context, maxOutputTokens: parsed.maxOutputTokens ?? 10000 });
		cell.context = { ...context, setBlocked: (id, active) => cell.setBlocked(id, active) };
		const usedImports = new Set<string>();
		const execution: TsExecution = { cell, start: isolated ? this.durable : this.state, isolated, done: Promise.resolve(), usedImports,
			imports: this.compilation.executionImports(isolated, cell.controller.signal, usedImports) };
		this.cells.set(cell.id, execution);
		this.running++;
		this.delegate.bindCell(cell.id, cell.context, new Map(tools.map(tool => [tool.name, tool])));
		const abort = () => { void this.kernel.stop(execution, this.delegate); };
		signal?.addEventListener("abort", abort, { once: true });
		const run = async (): Promise<void> => { if (!isolated) execution.start = this.state; await this.run(execution, tools); };
		execution.done = (isolated ? run() : this.liveQueue.then(run)).finally(() => signal?.removeEventListener("abort", abort));
		if (!isolated) this.liveQueue = execution.done.catch(() => {});
		return this.observe(execution, directToolYieldTime(parsed.code, tools) ?? parsed.yieldTimeMs ?? DEFAULT_CODE_MODE_EXEC_YIELD_MS, signal);
	}

	async wait(cellId: string, yieldTimeMs: number, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		await this.prepare(context);
		const execution = this.cells.get(cellId);
		if (!execution) return { kind: "result", cellId, contentItems: [], missingCell: true };
		execution.cell.context = { ...context, setBlocked: (id, active) => execution.cell.setBlocked(id, active) };
		this.delegate.updateCellContext(cellId, execution.cell.context);
		return this.observe(execution, yieldTimeMs, signal);
	}

	async terminate(cellId: string, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		await this.prepare(context);
		const execution = this.cells.get(cellId);
		if (!execution) return { kind: "terminated", cellId, contentItems: [], missingCell: true };
		await this.kernel.stop(execution, this.delegate);
		return this.response(execution, "terminated");
	}

	async checkpoint(): Promise<void> {
		await this.liveQueue;
		await this.transaction(async () => {
			if (!this.storage || this.kernel.unavailable) return;
			const capture = await this.capture();
			const lostPins = capture.skipped.filter(item => this.state.pins.includes(item.name));
			if (lostPins.length) throw new Error(`TS checkpoint not updated: pinned bindings are live-only (${lostPins.map(item => item.name).join(", ")}). Restore portable values or explicitly unpin them first`);
			const notice = await this.commitState(capture.state, "checkpoint");
			if (notice) throw new Error(notice);
		});
	}

	async controlNotebook(request: NotebookControlRequest, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		signal?.throwIfAborted();
		await this.prepare(context);
		return this.transaction(async () => { signal?.throwIfAborted(); this.controlRequest = request; try {
			if (request.action === "unpin" && this.kernel.failedRestores) return await this.recoverRestore(request.names);
			return await this.lifecycle.control(request);
		} finally { this.controlRequest = undefined; } });
	}

	async shutdown(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.phase = "closing";
		this.shutdownPromise = (async () => { await this.preparing; await this.stopSession(); })().finally(() => { this.phase = "ready"; this.shutdownPromise = undefined; });
		await this.shutdownPromise;
	}
	clearOpaqueResults(): void { this.delegate.clearOpaqueResults(); }

	private async stopSession(): Promise<void> {
		this.generation++;
		await Promise.all([...this.cells.values()].map(execution => this.kernel.stop(execution, this.delegate)));
		await Promise.all([...this.cells.values()].map(execution => execution.done));
		await this.committing;
		await this.kernel.reset();
		this.compilation.clearSourceModules();
		await this.compilation.closeCompiler();
		this.delegate.clear();
		this.cells.clear();
		this.storage = undefined;
		this.identity = undefined;
		this.state = emptyState();
		this.durable = emptyState();
		this.observedProject = emptyState();
		await this.compilation.removeSessionSources();
	}

	private async prepare(context: ToolExecutionContext): Promise<void> {
		if (this.phase === "closing") throw new Error("TS session is shutting down; wait for it to finish before executing");
		const id = this.contextKey(context);
		const prepared = this.preparing.then(async () => {
			if (this.phase === "closing") throw new Error("TS session is shutting down");
			if (this.identity === id) return;
			await this.stopSession();
			this.compilation.beginSession(context.cwd);
			const storage = new TsStateStorage(this.options.agentDir, context.cwd, id, this.options.maxHeapMiB * 1024 * 1024 / 8);
			const initial = await storage.initial();
			if (this.options.profile && Object.keys(initial.state.bindings).length === 0) initial.state = await storage.readProfile(this.options.profile);
			if (this.isClosing()) throw new Error("TS session changed during startup; start a new cell");
			this.storage = storage;
			this.state = initial.state;
			this.durable = initial.state;
			this.observedProject = initial.observedProject;
			this.identity = id;
		});
		this.preparing = prepared.catch(() => {});
		await prepared;
	}
	private contextKey(context: ToolExecutionContext): string {
		if (!context.extensionContext) throw new Error("TS execution requires an extension session context");
		return JSON.stringify([context.cwd, notebookSessionIdentity(context.extensionContext)]);
	}
	private isClosing(): boolean { return this.phase === "closing"; }

	private async run(execution: TsExecution, tools: CodeModeToolDefinition[]): Promise<void> {
		const { cell, start } = execution;
		const generation = this.generation;
		try {
			const input = await this.compilation.compile(cell.source, start, execution.isolated, execution.imports, tools, cell.controller.signal);
			const bindings = input.bindings;
			const outcome = await this.kernel.launch(execution, input, this.delegate);
			const candidate = outcome.state;
			candidate.imports = [...new Set([...start.imports, ...execution.usedImports])];
			cell.controller.signal.throwIfAborted();
			await this.transaction(async () => {
				if (generation !== this.generation || cell.controller.signal.aborted) throw new Error("TS cell was cancelled");
				if (execution.isolated) {
					const name = `candidate-${cell.id}`;
					await this.storage?.write(candidate, name);
					cell.emit([{ type: "input_text", text: `Isolated result saved as ${name}; the live notebook was not changed. Loading this candidate explicitly replaces the live kernel and discards its live-only values and later changes.` }]);
					return;
				}
				this.state = { ...candidate, bindings: outcome.kind === "live-done" && !outcome.sourceStarted ? start.bindings : bindings, pins: start.pins };
				this.kernel.recordOutcome(outcome);
				if (outcome.kind === "live-done" && outcome.error) throw new Error(outcome.error);
				if (outcome.kind === "live-done" && outcome.captureError) { cell.emit([{ type: "input_text", text: `Live cell succeeded, but its durable checkpoint and project pins were not updated: ${outcome.captureError}. Live values remain available.` }]); return; }
				const lostPins = outcome.kind === "live-done" ? outcome.skipped.filter(item => start.pins.includes(item.name)) : [];
				if (lostPins.length) { cell.emit([{ type: "input_text", text: `Live cell succeeded, but its durable checkpoint and project pins were not updated: ${lostPins.map(item => `${item.name} (${item.reason})`).join("; ")}. Restore portable values or explicitly unpin them before checkpointing.` }]); return; }
				compactState(candidate);
				await this.storage?.write(candidate);
				this.durable = candidate;
				if (outcome.kind === "live-done" && outcome.skipped.length) cell.emit([{ type: "input_text", text: formatSkipped(outcome).trimStart() }]);
				const notice = await this.syncProject();
				if (notice) cell.emit([{ type: "input_text", text: notice }]);
			});
			cell.result = { status: "ok", items: [] };
		} catch (error) {
			const recovery = execution.worker || (!execution.isolated && this.kernel.unavailable)
				? `${execution.isolated ? "Isolated state was not adopted." : this.kernel.unavailable ? "The live kernel stopped; live-only values and changes after its last durable checkpoint were lost. Use notebook restart to restore that checkpoint." : "Earlier live mutations may remain; no rollback occurred. Continue inspecting the live notebook, or restart from its last durable checkpoint."} Tool and file effects were not rolled back.`
				: "The cell did not execute; no cell tool calls or file writes ran. Fix the error and retry.";
			cell.result = { status: "error", items: [], errorText: `${error instanceof Error ? error.message : String(error)}\n${recovery}` };
		}
		finally {
			this.delegate.cancelCell(cell.id);
			if (execution.isolated) await execution.worker?.stop();
			this.running--;
			cell.markCompleted();
		}
	}

	private transaction<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.committing.then(operation);
		this.committing = result.then(() => {}, () => {});
		return result;
	}
	private async capture(bindings?: Record<string, BindingRecipe>): Promise<PortableCapture> {
		if (this.kernel.unavailable) throw new Error("The TS live kernel stopped; use notebook restart to restore the last durable checkpoint");
		if (!this.kernel.hasWorker && !bindings) return { state: this.durable, skipped: [] };
		const input = { ...this.compilation.workerInput(this.state, this.state.bindings, this.latestTools), captureOnly: true };
		const result = await this.kernel.capture(input, this.compilation.cwd, bindings, name => this.compilation.resolveImport(name));
		if (!bindings) this.state = { ...result.state, bindings: this.state.bindings, pins: this.state.pins };
		return result;
	}
	private async resetKernel(state: PortableState): Promise<void> {
		await this.kernel.reset();
		this.compilation.clearSourceModules();
		this.state = state;
	}
	private async recoverRestore(names: string[]): Promise<NotebookControlResult> {
		if (this.running) throw new Error("Wait for active TS cells before recovering a failed restore");
		const removed = new Set(this.kernel.failedRestores);
		let previousSize = -1;
		while (previousSize !== removed.size) {
			previousSize = removed.size;
			for (const binding of Object.values(this.durable.bindings)) if (bindingDependencies(binding).some(name => removed.has(name))) removed.add(binding.name);
		}
		for (const name of removed) if (!names.includes(name)) throw new Error(`TS restore recovery discards unavailable bindings, aliases and dependants: ${[...removed].join(", ")}. Explicitly unpin all these names together, or reset`);
		const next = structuredClone(this.durable);
		for (const name of removed) { delete next.bindings[name]; delete next.roots[name]; }
		for (const name of names) if (next.bindings[name]) { delete next.bindings[name].checkpoint; delete next.bindings[name].hook; }
		next.pins = next.pins.filter(name => !names.includes(name));
		compactState(next);
		const notice = await this.commitState(next, "adopt");
		return { message: `TS restore recovery discarded unavailable bindings: ${[...removed].join(", ")}. Other saved bindings were preserved${notice ? `\n${notice}` : ""}`, details: { discarded: [...removed] } };
	}
	private async commitState(next: PortableState, action?: NotebookControlRequest["action"] | "adopt"): Promise<string | undefined> {
		await this.compilation.validateDeclarations(next);
		if (action === "adopt" || action === "release" || action === "prune") await this.resetKernel(next);
		else {
			if (action === "load" && this.kernel.hasWorker) {
				const added = Object.fromEntries(Object.entries(next.bindings).filter(([name]) => !Object.hasOwn(this.state.bindings, name)));
				const restore = compactState({ ...next, bindings: added, roots: Object.fromEntries(Object.entries(next.roots).filter(([name]) => Object.hasOwn(added, name))) });
				const input = { ...this.compilation.workerInput(this.state, { ...this.state.bindings, ...next.bindings }, this.latestTools), captureOnly: true };
				await this.kernel.restoreAdditions(input, restore, name => this.compilation.resolveImport(name));
			}
			this.state = { ...next, bindings: { ...this.state.bindings, ...next.bindings } };
			if (action === "unpin" && this.controlRequest?.action === "unpin") for (const name of this.controlRequest.names) {
				const binding = this.state.bindings[name];
				if (binding) { const retained = { ...binding }; delete retained.hook; delete retained.checkpoint; this.state.bindings[name] = retained; }
			}
		}
		await this.requireStorage().write(next);
		this.durable = next;
		return this.syncProject();
	}
	private requireStorage(): TsStateStorage {
		if (!this.storage) throw new Error("TS state storage is unavailable; start a new cell");
		return this.storage;
	}

	private async syncProject(): Promise<string | undefined> {
		if (!this.storage) return undefined;
		try {
			const candidate = selectProjectPins(this.durable);
			await this.compilation.validateDeclarations(candidate);
			const result = await this.storage.mergeProject(this.observedProject, candidate);
			if (result.conflicts.length) {
				const name = `candidate-project-${randomUUID().slice(0, 8)}`;
				await this.storage.write(this.state, name);
				return `TS session state committed, but project pins conflict (${result.conflicts.join(", ")}). Project state was preserved; candidate saved as ${name}. Load it while this session is idle to recover the candidate, or unpin the conflicting binding before checkpointing.`;
			}
			await this.storage.write(candidate, "observed-project");
			this.observedProject = candidate;
		} catch (error) { return `TS session state committed, but project pins were not saved: ${error instanceof Error ? error.message : String(error)}. Retry notebook checkpoint.`; }
		return undefined;
	}
	private async observe(execution: TsExecution, yieldTimeMs: number, signal?: AbortSignal): Promise<RuntimeResponse> {
		const kind = await execution.cell.observe(yieldTimeMs, signal);
		if (kind === "result") await execution.cell.waitForCompletion();
		return this.response(execution, kind);
	}
	private response(execution: TsExecution, kind: RuntimeResponse["kind"]): RuntimeResponse {
		const cell = execution.cell;
		const response: RuntimeResponse = kind === "result" ? { kind, cellId: cell.id, contentItems: cell.takeContent(), ...(cell.result?.errorText ? { errorText: cell.result.errorText } : {}), maxOutputTokens: cell.maxOutputTokens } : { kind, cellId: cell.id, contentItems: cell.takeContent(), maxOutputTokens: cell.maxOutputTokens };
		const attached = this.delegate.attach(response);
		if (kind !== "yielded") { this.cells.delete(cell.id); this.delegate.closeCell(cell.id); }
		return attached;
	}
}
