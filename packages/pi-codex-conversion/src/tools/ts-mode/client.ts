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
import { compactState, emptyState, mergeState, type BindingRecipe, type PortableState } from "./portable-state.ts";
import { TsStateStorage } from "./state-storage.ts";
import { buildTsToolDeclarations } from "./tool-declarations.ts";
import { TS_GLOBAL_DECLARATIONS, type TsWorkerInput } from "./worker-protocol.ts";

interface Execution {
	cell: NotebookCell;
	start: PortableState;
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

	constructor(options: NotebookRuntimeOptions, renderStore?: CodeModeNestedRenderStore) {
		if (!((process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64")) || (process.platform === "darwin" && process.arch === "arm64"))) throw new Error(`TS is unavailable on ${process.platform}/${process.arch}; choose Code or Deno Notebook. TS supports Linux x64/arm64 and Apple Silicon Macs.`);
		if (process.versions["bun"]) throw new Error("TS execution requires a Node.js Pi host; start Pi with Node.js. Code and Deno Notebook remain available.");
		if (!Number.isSafeInteger(options.maxHeapMiB) || options.maxHeapMiB < 64) throw new Error("TS requires a session heap budget of at least 64 MiB");
		this.options = options;
		this.delegate = new CodeModeDelegateRuntime(() => undefined, renderStore);
		this.importOptions = { cwd: process.cwd(), cacheDir: join(options.agentDir, "ts-imports") };
		this.lifecycle = new TsStateLifecycle({
			state: () => this.state,
			storage: () => this.requireStorage(),
			activeCells: () => [...this.cells.values()].filter(execution => !execution.cell.isCompleted()).map(execution => execution.cell.id),
			commit: async state => { await this.validateDeclarations(state); await this.requireStorage().write(state); this.state = state; return this.syncProject(); },
			syncProject: () => this.syncProject(),
			restart: async () => { const compiler = this.compiler; this.compiler = undefined; await compiler?.close(); },
			reset: async () => {
				const project = await this.requireStorage().readProject();
				await this.requireStorage().write(project);
				this.state = project;
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
		const parsed = parseExecSource(source);
		const cell = new NotebookCell({ id: `ts-${++this.nextId}-${randomUUID().slice(0, 8)}`, source: parsed.code, context, maxOutputTokens: parsed.maxOutputTokens ?? 10000 });
		cell.context = { ...context, setBlocked: (id, active) => cell.setBlocked(id, active) };
		const usedImports = new Set<string>();
		const execution: Execution = { cell, start: this.state, done: Promise.resolve(), usedImports,
			imports: { ...this.importOptions, ...(this.compiler ? { compiler: this.compiler } : {}), signal: cell.controller.signal, sourceModules: new Map(), onNpmImport: specifier => usedImports.add(specifier) } };
		this.cells.set(cell.id, execution);
		this.running++;
		this.delegate.bindCell(cell.id, cell.context, new Map(tools.map(tool => [tool.name, tool])));
		const abort = () => { void this.stop(execution); };
		signal?.addEventListener("abort", abort, { once: true });
		execution.done = this.run(execution, tools).finally(() => signal?.removeEventListener("abort", abort));
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
		await this.transaction(async () => { await this.storage?.write(this.state); const notice = await this.syncProject(); if (notice) throw new Error(notice); });
	}

	async controlNotebook(request: NotebookControlRequest, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		signal?.throwIfAborted();
		await this.prepare(context);
		return this.transaction(async () => { signal?.throwIfAborted(); return this.lifecycle.control(request); });
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
		await this.compiler?.close();
		this.compiler = undefined;
		this.delegate.clear();
		this.cells.clear();
		this.storage = undefined;
		this.identity = undefined;
		this.state = emptyState();
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
			const compiled = await compiler.compile({ source: cell.source, baselineDeclarations, globalsDeclaration: `${TS_GLOBAL_DECLARATIONS}\n${buildTsToolDeclarations(tools)}`, ...imports }).catch(error => { throw this.compilerFailure(error); });
			if (!compiled.ok) throw new Error(compiled.diagnostics.map(diagnostic => `TS${diagnostic.code}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""} ${diagnostic.message}`).join("\n"));
			cell.controller.signal.throwIfAborted();
			const bindings: Record<string, BindingRecipe> = { ...start.bindings };
			for (const binding of compiled.bindings) {
				if (binding.name.startsWith("__") || ["tools", "text", "image", "generatedImage", "notify", "store", "load", "ALL_TOOLS", "exit", "yield_control"].includes(binding.name)) throw new Error(`TS binding ${binding.name} is reserved; choose another name`);
				if (Object.hasOwn(start.bindings, binding.name)) throw new Error(`TS binding ${binding.name} already exists; assign to a let binding, or release it before declaring it again`);
				if (binding.kind === "class" || binding.kind === "namespace") throw new Error(`${binding.name}: ${binding.kind} bindings cannot transfer yet; use plain data and top-level functions`);
				bindings[binding.name] = { name: binding.name, kind: binding.kind, declaration: binding.declaration, references: binding.freeReferences, ...(binding.source ? { source: binding.source } : {}) };
			}
			for (const imported of compiled.imports) if (!imported.typeOnly) for (const binding of imported.bindings) {
				if (binding.typeOnly) continue;
				const recipe = bindings[binding.local];
				if (recipe) recipe.module = { specifier: imported.specifier, imported: binding.imported, ...(imported.attributes ? { attributes: imported.attributes } : {}) };
			}
			const input: TsWorkerInput = { state: start, javascript: compiled.javascript, bindings,
				toolNames: Object.fromEntries(tools.map(tool => [codeModeGlobalName(tool.name), tool.name])),
				toolMetadata: tools.filter(isCodeModeToolDiscoverable).map(tool => ({ name: codeModeGlobalName(tool.name), description: formatCodeModeToolHelp(tool) })),
				outputHints: Object.fromEntries(tools.flatMap(tool => "textOutput" in tool && tool.textOutput ? [[tool.name, tool.textOutput]] : [])),
				commandFormatter: commandOutputFormatterSource, maxStateBytes: this.options.maxHeapMiB * 1024 * 1024 / 8 };
			const candidate = await this.launch(execution, input);
			candidate.imports = [...new Set([...start.imports, ...execution.usedImports])];
			cell.controller.signal.throwIfAborted();
			await this.transaction(async () => {
				if (generation !== this.generation || cell.controller.signal.aborted) throw new Error("TS cell cancelled before commit; committed state is unchanged");
				const merged = mergeState(start, this.state, candidate);
				if (merged.conflicts.length) {
					const name = `candidate-${cell.id}`;
					await this.storage?.write(candidate, name);
					throw new Error(`TS state conflict (${merged.conflicts.join(", ")}); committed state is unchanged. Candidate saved as ${name}. Loading it while idle replaces the entire baseline, including newer writes from other cells; save current state first if needed.`);
				}
				compactState(merged.state);
				await this.storage?.write(merged.state);
				this.state = merged.state;
				const notice = await this.syncProject();
				if (notice) cell.emit([{ type: "input_text", text: notice }]);
			});
			cell.result = { status: "ok", items: [] };
		} catch (error) { cell.result = { status: "error", items: [], errorText: `${error instanceof Error ? error.message : String(error)}\nTS state was not committed; tool and file effects were not rolled back.` }; }
		finally {
			this.delegate.cancelCell(cell.id);
			await execution.worker?.stop();
			this.running--;
			cell.markCompleted();
		}
	}

	private launch(execution: Execution, input: TsWorkerInput): Promise<PortableState> {
		execution.worker = new TsExecutionWorker({ cwd: execution.cell.context.cwd, heapMiB: Math.floor(this.options.maxHeapMiB / MAX_WORKERS), input,
			callbacks: {
				output: items => execution.cell.emit(items),
				notify: text => this.delegate.notifyDirect(execution.cell.id, text),
				yield: () => execution.cell.requestYield(),
				request: async (operation, id, name, value) => {
					execution.cell.controller.signal.throwIfAborted();
					return operation === "tool" ? this.delegate.invokeDirect(execution.cell.id, id, name, value) : resolveTsRuntimeImport(name, execution.imports);
				},
			} });
		return execution.worker.result;
	}

	private async stop(execution: Execution): Promise<void> {
		if (execution.stop) return execution.stop;
		if (execution.cell.isCompleted()) return;
		execution.stop = (async () => {
			execution.cell.terminated = true;
			execution.cell.controller.abort();
			this.delegate.cancelCell(execution.cell.id);
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
			const candidate = selectProjectPins(this.state);
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
