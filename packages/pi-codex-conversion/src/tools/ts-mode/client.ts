import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../code-mode/custom-tool-prompt.ts";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import { commandOutputFormatterSource } from "../code-mode/command-output.ts";
import { DEFAULT_CODE_MODE_EXEC_YIELD_MS, parseExecSource } from "../code-mode/host-protocol.ts";
import type { CodeModeExecutionClient, NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type { CodeModeToolDefinition, NotebookControlRequest, NotebookControlResult, RuntimeResponse, ToolExecutionContext } from "../code-mode/types.ts";
import { NotebookCell } from "../notebook-mode/cell.ts";
import { notebookSessionIdentity } from "../notebook-mode/session-identity.ts";
import { TsCompiler } from "./compiler.ts";
import { TsExecutionWorker } from "./execution-worker.ts";
import { resolveTsImports, resolveTsRuntimeImport, type TsImportOptions } from "./imports.ts";
import { selectProjectPins, TsStateLifecycle } from "./lifecycle.ts";
import { bindingDependencies, compactState, emptyState, type BindingRecipe, type PortableCapture, type PortableState } from "./portable-state.ts";
import { TsStateStorage } from "./state-storage.ts";
import { buildTsToolDeclarations } from "./tool-declarations.ts";
import { TS_GLOBAL_DECLARATIONS, type TsWorkerInput, type TsWorkerOutcome } from "./worker-protocol.ts";

interface Execution {
	cell: NotebookCell;
	start: PortableState;
	isolated: boolean;
	worker?: TsExecutionWorker | undefined;
	imports: TsImportOptions;
	usedImports: Set<string>;
	done: Promise<void>;
	stop?: Promise<void> | undefined;
}

const MAX_WORKERS = 4;

export class TsCodeModeClient implements CodeModeExecutionClient {
	private readonly options: NotebookRuntimeOptions;
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly lifecycle: TsStateLifecycle;
	private readonly cells = new Map<string, Execution>();
	private state = emptyState();
	private durable = emptyState();
	private kernel: TsExecutionWorker | undefined;
	private kernelUnavailable = false;
	private restoreFailed: string[] | undefined;
	private liveQueue: Promise<void> = Promise.resolve();
	private latestTools: CodeModeToolDefinition[] = [];
	private controlRequest: NotebookControlRequest | undefined;
	private observedProject = emptyState();
	private storage: TsStateStorage | undefined;
	private compiler: TsCompiler | undefined;
	private identity: string | undefined;
	private preparing: Promise<void> = Promise.resolve();
	private committing: Promise<void> = Promise.resolve();
	private nextId = 0;
	private generation = 0;
	private running = 0;
	private phase: "ready" | "closing" = "ready";
	private shutdownPromise: Promise<void> | undefined;
	private readonly importOptions: TsImportOptions;
	private readonly liveSourceModules = new Map<string, string>();

	constructor(options: NotebookRuntimeOptions, renderStore?: CodeModeNestedRenderStore) {
		if (!((process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64")) || (process.platform === "darwin" && process.arch === "arm64"))) throw new Error(`TS is unavailable on ${process.platform}/${process.arch}; choose Code or Deno Notebook. TS supports Linux x64/arm64 and Apple Silicon Macs.`);
		if (process.versions["bun"]) throw new Error("TS execution requires a Node.js Pi host; start Pi with Node.js. Code and Deno Notebook remain available.");
		if (!Number.isSafeInteger(options.maxHeapMiB) || options.maxHeapMiB < 128) throw new Error("TS requires a session heap budget of at least 128 MiB; increase the Notebook heap setting before selecting TS. Half is reserved for live execution and half for up to four isolated cells");
		this.options = options;
		this.delegate = new CodeModeDelegateRuntime(() => undefined, renderStore);
		this.importOptions = { cwd: process.cwd(), cacheDir: join(options.agentDir, "ts-imports"), sourceModules: this.liveSourceModules };
		this.lifecycle = new TsStateLifecycle({
			state: () => this.state,
			capture: bindings => this.capture(bindings),
			validateCheckpoint: (name, checkpoint) => this.validateCheckpoint(name, checkpoint),
			storage: () => this.requireStorage(),
			activeCells: () => [...this.cells.values()].filter(execution => !execution.cell.isCompleted()).map(execution => execution.cell.id),
			commit: (state, action) => this.commitState(state, action),
			syncProject: () => this.syncProject(),
			restart: async () => { await this.resetKernel(this.durable); const compiler = this.compiler; this.compiler = undefined; await compiler?.close(); },
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
		if (this.running >= MAX_WORKERS) throw new Error(`TS has ${MAX_WORKERS} active cells; wait for or terminate one before starting another`);
		if (this.cells.size >= 32) throw new Error("TS has 32 uncollected cell results; use wait to collect completed results before starting another cell");
		const parsed = parseExecSource(source, { allowIsolated: true });
		const isolated = parsed.isolated === true;
		if (!isolated && this.kernelUnavailable) throw new Error("The TS live kernel stopped. Use notebook restart to restore its last durable checkpoint; live-only values and later changes cannot be recovered");
		this.latestTools = tools;
		const cell = new NotebookCell({ id: `ts-${++this.nextId}-${randomUUID().slice(0, 8)}`, source: parsed.code, context, maxOutputTokens: parsed.maxOutputTokens ?? 10000 });
		cell.context = { ...context, setBlocked: (id, active) => cell.setBlocked(id, active) };
		const usedImports = new Set<string>();
		const execution: Execution = { cell, start: isolated ? this.durable : this.state, isolated, done: Promise.resolve(), usedImports,
			imports: { ...this.importOptions, ...(this.compiler ? { compiler: this.compiler } : {}), signal: cell.controller.signal, sourceModules: isolated ? new Map() : this.liveSourceModules, onNpmImport: specifier => usedImports.add(specifier) } };
		this.cells.set(cell.id, execution);
		this.running++;
		this.delegate.bindCell(cell.id, cell.context, new Map(tools.map(tool => [tool.name, tool])));
		const abort = () => { void this.stop(execution); };
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
		await this.stop(execution);
		return this.response(execution, "terminated");
	}

	async checkpoint(): Promise<void> {
		await this.liveQueue;
		await this.transaction(async () => {
			if (!this.storage || this.kernelUnavailable) return;
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
			if (request.action === "unpin" && this.restoreFailed) return await this.recoverRestore(request.names);
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
		await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
		await Promise.all([...this.cells.values()].map(execution => execution.done));
		await this.committing;
		await this.kernel?.stop();
		this.kernel = undefined;
		this.kernelUnavailable = false;
		this.restoreFailed = undefined;
		this.liveSourceModules.clear();
		await this.compiler?.close();
		this.compiler = undefined;
		this.delegate.clear();
		this.cells.clear();
		this.storage = undefined;
		this.identity = undefined;
		this.state = emptyState();
		this.durable = emptyState();
		this.observedProject = emptyState();
		if (this.importOptions.sourceDir) await rm(this.importOptions.sourceDir, { recursive: true, force: true });
		delete this.importOptions.sourceDir;
	}

	private async prepare(context: ToolExecutionContext): Promise<void> {
		if (this.phase === "closing") throw new Error("TS session is shutting down; wait for it to finish before executing");
		const id = this.contextKey(context);
		const prepared = this.preparing.then(async () => {
			if (this.phase === "closing") throw new Error("TS session is shutting down");
			if (this.identity === id) return;
			await this.stopSession();
			this.importOptions.cwd = context.cwd;
			this.importOptions.sourceDir = join(this.importOptions.cacheDir, "sessions", randomUUID());
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

	private async run(execution: Execution, tools: CodeModeToolDefinition[]): Promise<void> {
		const { cell, start } = execution;
		const generation = this.generation;
		try {
			const compiler = this.requireCompiler();
			execution.imports.compiler = compiler;
			const baselineDeclarations = Object.values(start.bindings).map(binding => binding.declaration).join("\n");
			const imports = await resolveTsImports(await this.scanImports(compiler, `${baselineDeclarations}\n${cell.source}`), execution.imports);
			cell.controller.signal.throwIfAborted();
			const compiled = await compiler.compile({ source: cell.source, mode: execution.isolated ? "isolated" : "live", baselineDeclarations, globalsDeclaration: `${TS_GLOBAL_DECLARATIONS}\n${buildTsToolDeclarations(tools)}`, ...imports }).catch(error => { throw this.compilerFailure(error); });
			if (!compiled.ok) throw new Error(compiled.diagnostics.map(diagnostic => `TS${diagnostic.code}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""} ${diagnostic.message}`).join("\n"));
			cell.controller.signal.throwIfAborted();
			const bindings: Record<string, BindingRecipe> = { ...start.bindings };
			for (const binding of compiled.bindings) {
				if (binding.name.startsWith("__") || ["tools", "text", "image", "generatedImage", "notify", "store", "load", "ALL_TOOLS", "exit", "yield_control"].includes(binding.name)) throw new Error(`TS binding ${binding.name} is reserved; choose another name`);
				if (Object.hasOwn(start.bindings, binding.name)) throw new Error(`TS binding ${binding.name} already exists; assign to a let binding, or release it before declaring it again`);
				if (execution.isolated && (binding.kind === "class" || binding.kind === "namespace")) throw new Error(`${binding.name}: ${binding.kind} bindings cannot transfer from isolated execution; use a normal live cell`);
				bindings[binding.name] = { name: binding.name, kind: binding.kind, declaration: binding.declaration, references: binding.freeReferences, ...(binding.source ? { source: binding.source } : {}) };
			}
			for (const imported of compiled.imports) if (!imported.typeOnly) for (const binding of imported.bindings) {
				if (binding.typeOnly) continue;
				const recipe = bindings[binding.local];
				if (recipe) recipe.module = { specifier: imported.specifier, imported: binding.imported, ...(imported.attributes ? { attributes: imported.attributes } : {}) };
			}
			const input: TsWorkerInput = { mode: execution.isolated ? "isolated" : "live", state: start, javascript: compiled.javascript, bindings,
				toolNames: Object.fromEntries(tools.map(tool => [codeModeGlobalName(tool.name), tool.name])),
				toolMetadata: tools.filter(isCodeModeToolDiscoverable).map(tool => ({ name: codeModeGlobalName(tool.name), description: formatCodeModeToolHelp(tool) })),
				outputHints: Object.fromEntries(tools.flatMap(tool => "textOutput" in tool && tool.textOutput ? [[tool.name, tool.textOutput]] : [])),
				commandFormatter: commandOutputFormatterSource, maxStateBytes: this.options.maxHeapMiB * 1024 * 1024 / 8 };
			const outcome = await this.launch(execution, input);
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
				if (outcome.kind === "live-done" && outcome.restoreFailed) this.restoreFailed = outcome.restoreFailed;
				if (outcome.kind === "live-done" && outcome.error) throw new Error(outcome.error);
				if (outcome.kind === "live-done" && outcome.captureError) { cell.emit([{ type: "input_text", text: `Live cell succeeded, but its durable checkpoint and project pins were not updated: ${outcome.captureError}. Live values remain available.` }]); return; }
				const lostPins = outcome.kind === "live-done" ? outcome.skipped.filter(item => start.pins.includes(item.name)) : [];
				if (lostPins.length) { cell.emit([{ type: "input_text", text: `Live cell succeeded, but its durable checkpoint and project pins were not updated: ${lostPins.map(item => `${item.name} (${item.reason})`).join("; ")}. Restore portable values or explicitly unpin them before checkpointing.` }]); return; }
				compactState(candidate);
				await this.storage?.write(candidate);
				this.durable = candidate;
				const notice = await this.syncProject();
				if (notice) cell.emit([{ type: "input_text", text: notice }]);
			});
			cell.result = { status: "ok", items: [] };
		} catch (error) { cell.result = { status: "error", items: [], errorText: `${error instanceof Error ? error.message : String(error)}\n${execution.isolated ? "Isolated state was not adopted." : this.kernelUnavailable ? "The live kernel stopped; live-only values and changes after its last durable checkpoint were lost. Use notebook restart to restore that checkpoint." : execution.worker ? "Earlier live mutations may remain; no rollback occurred. Continue inspecting the live notebook, or restart from its last durable checkpoint." : "The cell did not execute."} Tool and file effects were not rolled back.` }; }
		finally {
			this.delegate.cancelCell(cell.id);
			if (execution.isolated) await execution.worker?.stop();
			this.running--;
			cell.markCompleted();
		}
	}

	private launch(execution: Execution, input: TsWorkerInput): Promise<TsWorkerOutcome> {
		if (!execution.isolated && this.kernelUnavailable) throw new Error("The live kernel is unavailable; use notebook restart");
		// Reserve half for the persistent heap and split the other half across bounded isolated runs.
		execution.worker = execution.isolated ? new TsExecutionWorker({ cwd: execution.cell.context.cwd, heapMiB: Math.floor(this.options.maxHeapMiB / (MAX_WORKERS * 2)) }) : this.kernel ??= new TsExecutionWorker({ cwd: execution.cell.context.cwd, heapMiB: Math.floor(this.options.maxHeapMiB / 2) });
		return execution.worker.execute(input, {
				output: items => execution.cell.emit(items),
				notify: text => this.delegate.notifyDirect(execution.cell.id, text),
				yield: () => execution.cell.requestYield(),
				request: async (operation, id, name, value) => {
					execution.cell.controller.signal.throwIfAborted();
					return operation === "tool" ? this.delegate.invokeDirect(execution.cell.id, id, name, value) : resolveTsRuntimeImport(name, execution.imports);
				},
			}).catch(async error => {
				if (!execution.isolated) { this.kernelUnavailable = true; await execution.worker?.stop(); }
				throw error;
			});
	}

	private async stop(execution: Execution): Promise<void> {
		if (execution.stop) return execution.stop;
		if (execution.cell.isCompleted()) return;
		execution.stop = (async () => {
			execution.cell.terminated = true;
			execution.cell.controller.abort();
			this.delegate.cancelCell(execution.cell.id);
			if (!execution.isolated && execution.worker) {
				this.kernelUnavailable = true;
				execution.cell.emit([{ type: "input_text", text: "The TS live kernel was terminated; live-only values and changes after its last durable checkpoint were lost. Use notebook restart to restore that checkpoint. Tool and file effects were not rolled back." }]);
			}
			await execution.worker?.stop();
			await execution.done;
		})();
		return execution.stop;
	}
	private transaction<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.committing.then(operation);
		this.committing = result.then(() => {}, () => {});
		return result;
	}
	private captureInput(): TsWorkerInput {
		return { mode: "live", captureOnly: true, state: this.state, javascript: "", bindings: this.state.bindings,
			toolNames: Object.fromEntries(this.latestTools.map(tool => [codeModeGlobalName(tool.name), tool.name])),
			toolMetadata: this.latestTools.filter(isCodeModeToolDiscoverable).map(tool => ({ name: codeModeGlobalName(tool.name), description: formatCodeModeToolHelp(tool) })),
			outputHints: Object.fromEntries(this.latestTools.flatMap(tool => "textOutput" in tool && tool.textOutput ? [[tool.name, tool.textOutput]] : [])),
			commandFormatter: commandOutputFormatterSource, maxStateBytes: this.options.maxHeapMiB * 1024 * 1024 / 8 };
	}
	private async capture(bindings?: Record<string, BindingRecipe>): Promise<PortableCapture> {
		if (this.kernelUnavailable) throw new Error("The TS live kernel stopped; use notebook restart to restore the last durable checkpoint");
		if (!this.kernel && !bindings) return { state: this.durable, skipped: [] };
		this.kernel ??= new TsExecutionWorker({ cwd: this.importOptions.cwd, heapMiB: Math.floor(this.options.maxHeapMiB / 2) });
		const result = await this.kernel.execute({ ...this.captureInput(), ...(bindings ? { bindings } : {}) }, {
			output: () => {}, notify: () => {}, yield: () => {},
			request: async (operation, _id, name) => {
				if (operation === "tool") throw new Error("Tools cannot run during TS state capture; run a normal cell instead");
				return resolveTsRuntimeImport(name, { ...this.importOptions, compiler: this.requireCompiler() });
			},
		});
		if (result.kind !== "live-done") throw new Error("The TS live kernel did not return a capture");
		if (result.restoreFailed) this.restoreFailed = result.restoreFailed;
		if (result.error) throw new Error(result.error);
		if (result.captureError) throw new Error(`${result.captureError}. Live values remain available; the durable checkpoint was not updated`);
		if (!bindings) this.state = { ...result.state, bindings: this.state.bindings, pins: this.state.pins };
		return result;
	}
	private async resetKernel(state: PortableState): Promise<void> {
		await this.kernel?.stop();
		this.kernel = undefined;
		this.kernelUnavailable = false;
		this.restoreFailed = undefined;
		this.liveSourceModules.clear();
		this.state = state;
	}
	private async recoverRestore(names: string[]): Promise<NotebookControlResult> {
		if (this.running) throw new Error("Wait for active TS cells before recovering a failed restore");
		const removed = new Set(this.restoreFailed);
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
		await this.validateDeclarations(next);
		if (action === "adopt" || action === "release" || action === "prune") await this.resetKernel(next);
		else {
			if (action === "load" && this.kernel) {
				const added = Object.fromEntries(Object.entries(next.bindings).filter(([name]) => !Object.hasOwn(this.state.bindings, name)));
				const restore = compactState({ ...next, bindings: added, roots: Object.fromEntries(Object.entries(next.roots).filter(([name]) => Object.hasOwn(added, name))) });
				const result = await this.kernel.execute({ ...this.captureInput(), bindings: { ...this.state.bindings, ...next.bindings }, restore }, {
					output: () => {}, notify: () => {}, yield: () => {},
					request: async (operation, _id, name) => {
						if (operation === "tool") throw new Error("Tools cannot run while loading TS state");
						return resolveTsRuntimeImport(name, { ...this.importOptions, compiler: this.requireCompiler() });
					},
				});
				if (result.kind === "live-done" && result.restoreFailed) this.restoreFailed = result.restoreFailed;
				if (result.kind === "live-done" && result.error) throw new Error(`TS profile load partially executed: ${result.error}. Inspect the live state or restart; no rollback occurred`);
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
	private requireCompiler(): TsCompiler {
		try { this.compiler ??= new TsCompiler({ cwd: this.importOptions.cwd }); }
		catch { throw new Error("The TS compiler could not start. Reinstall the extension with optional dependencies included, then retry; Code and Deno Notebook remain available."); }
		return this.compiler;
	}
	private compilerFailure(cause: unknown): Error { return new Error("The TS compiler is unavailable. Try notebook restart; if it still cannot start, reinstall the extension with optional dependencies included. Code and Deno Notebook remain available.", { cause }); }
	private async scanImports(compiler: TsCompiler, source: string): Promise<string[]> {
		try { return await compiler.scanImports(source); }
		catch (error) { throw this.compilerFailure(error); }
	}
	private async validateCheckpoint(name: string, checkpoint: NonNullable<BindingRecipe["checkpoint"]>): Promise<void> {
		for (const helper of [checkpoint.snapshot, checkpoint.restore]) {
			const binding = this.state.bindings[helper];
			if (!binding?.source && !binding?.module) throw new Error(`TS checkpoint helper ${helper} must be a named portable top-level function or import`);
			if (helper === name) throw new Error("TS checkpoint helpers must differ from the registered binding");
		}
		const compiler = this.requireCompiler();
		const baselineDeclarations = Object.values(this.state.bindings).map(binding => binding.declaration).join("\n");
		const imports = await resolveTsImports(await this.scanImports(compiler, baselineDeclarations), { ...this.importOptions, compiler });
		const result = await compiler.compile({ source: `const __checkpointData = await ${checkpoint.snapshot}(${name}); const __checkpointValue: typeof ${name} = await ${checkpoint.restore}(__checkpointData);`, baselineDeclarations, globalsDeclaration: TS_GLOBAL_DECLARATIONS + "\ndeclare const tools: Record<string, unknown>;", ...imports });
		if (!result.ok) throw new Error(`TS checkpoint helpers are incompatible: ${result.diagnostics.map(diagnostic => `TS${diagnostic.code} ${diagnostic.message}`).join("; ")}`);
	}
	private async validateDeclarations(state: PortableState): Promise<void> {
		const baselineDeclarations = Object.values(state.bindings).map(binding => binding.declaration).join("\n");
		if (!baselineDeclarations) return;
		const compiler = this.requireCompiler();
		const imports = await resolveTsImports(await this.scanImports(compiler, baselineDeclarations), { ...this.importOptions, compiler });
		const result = await compiler.compile({ source: "", baselineDeclarations, globalsDeclaration: TS_GLOBAL_DECLARATIONS + "\ndeclare const tools: Record<string, unknown>;", ...imports });
		if (!result.ok) throw new Error(`TS declarations would become invalid; retain their type dependencies or release dependent bindings together: ${result.diagnostics.map(diagnostic => `TS${diagnostic.code} ${diagnostic.message}`).join("; ")}`);
	}
	private async syncProject(): Promise<string | undefined> {
		if (!this.storage) return undefined;
		try {
			const candidate = selectProjectPins(this.durable);
			await this.validateDeclarations(candidate);
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
	private async observe(execution: Execution, yieldTimeMs: number, signal?: AbortSignal): Promise<RuntimeResponse> {
		const kind = await execution.cell.observe(yieldTimeMs, signal);
		if (kind === "result") await execution.cell.waitForCompletion();
		return this.response(execution, kind);
	}
	private response(execution: Execution, kind: RuntimeResponse["kind"]): RuntimeResponse {
		const cell = execution.cell;
		const response: RuntimeResponse = kind === "result" ? { kind, cellId: cell.id, contentItems: cell.takeContent(), ...(cell.result?.errorText ? { errorText: cell.result.errorText } : {}), maxOutputTokens: cell.maxOutputTokens } : { kind, cellId: cell.id, contentItems: cell.takeContent(), maxOutputTokens: cell.maxOutputTokens };
		const attached = this.delegate.attach(response);
		if (kind !== "yielded") { this.cells.delete(cell.id); this.delegate.closeCell(cell.id); }
		return attached;
	}
}
