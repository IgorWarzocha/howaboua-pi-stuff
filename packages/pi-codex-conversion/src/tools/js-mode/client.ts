import { randomUUID } from "node:crypto";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../code-mode/custom-tool-prompt.ts";
import { DEFAULT_CODE_MODE_EXEC_YIELD_MS, parseExecSource } from "../code-mode/host-protocol.ts";
import type { CodeModeExecutionClient, NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type { CodeModeToolDefinition, NotebookControlRequest, NotebookControlResult, RuntimeResponse, ToolExecutionContext } from "../code-mode/types.ts";
import { NotebookCell } from "../notebook-mode/cell.ts";
import { notebookSessionIdentity } from "../notebook-mode/session-identity.ts";
import { globMatcher } from "../notebook-mode/glob.ts";
import { JsKernel } from "./kernel.ts";
import { loadJsRuntime, type JsRuntime } from "./runtime.ts";
import { RuntimeInstallError } from "../code-mode/runtime-package.ts";
import { JsStateStorage } from "./storage.ts";
import { JsDataStorage } from "./data-storage.ts";
import { emptyState, forkPortableState } from "../ts-mode/portable-state.ts";
import type { JsBindingStatus, JsInput, JsOutcome, JsSnapshot, JsTool } from "./protocol.ts";

interface Execution { cell: NotebookCell; isolated: boolean; kernel?: JsKernel; done: Promise<void>; stopping?: Promise<void> }
const MAX_CELLS = 4;
const NO_TOOLS = { output: () => {}, notify: () => {}, yield: () => {}, request: async (): Promise<never> => { throw new Error("Tools are unavailable during checkpoint management"); } };

export class JsNotebookClient implements CodeModeExecutionClient {
	private readonly options: NotebookRuntimeOptions;
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly cells = new Map<string, Execution>();
	private identity: string | undefined;
	private inspectionOnly = false;
	private inspection: Promise<void> | undefined;
	private storage: JsStateStorage | undefined;
	private dataStorage: JsDataStorage | undefined;
	private observedProject = emptyState();
	private pins: string[] = [];
	private projectWarning: string | undefined;
	private durable: JsSnapshot | undefined;
	private dirty = false;
	private managing = 0;
	private migrationNotice: string | undefined;
	private kernel: JsKernel | undefined;
	private runtime: JsRuntime | undefined;
	private runtimeAbort = new AbortController();
	private unavailable = false;
	private startupError: string | undefined;
	private heapBytes = 0;
	private preparing: Promise<void> = Promise.resolve();
	private controls: Promise<void> = Promise.resolve();
	private liveQueue: Promise<void> = Promise.resolve();
	private closing: Promise<void> | undefined;
	private running = 0;
	private latestTools: JsTool[] = [];
	private bindings: JsBindingStatus[] = [];
	private inventoryComplete = true;
	private hooks: NonNullable<JsOutcome["hooks"]> = [];

	constructor(options: NotebookRuntimeOptions, renderStore?: CodeModeNestedRenderStore) {
		if (process.versions["bun"]) throw new Error("JS Notebook requires a Node.js Pi host; start Pi with Node.js. Code and Deno Notebook remain available");
		if (!Number.isSafeInteger(options.maxHeapMiB) || options.maxHeapMiB < 128) throw new Error("JS Notebook requires a Notebook heap budget of at least 128 MiB");
		this.options = options;
		this.delegate = new CodeModeDelegateRuntime(() => {}, renderStore);
	}
	private async createKernel(heapBytes: number, snapshot?: JsSnapshot, managementClone = false, signal?: AbortSignal): Promise<JsKernel> {
		signal = signal ? AbortSignal.any([signal, this.runtimeAbort.signal]) : this.runtimeAbort.signal;
		const runtime = this.runtime ?? await loadJsRuntime(this.options.agentDir, signal);
		signal.throwIfAborted();
		this.runtime = runtime;
		return JsKernel.create(runtime, heapBytes, snapshot, managementClone);
	}

	async execute(source: string, context: ToolExecutionContext, signal?: AbortSignal, tools: CodeModeToolDefinition[] = []): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		await this.prepare(context, false, signal); await this.controls; await this.inspection;
		signal?.throwIfAborted(); this.assertReady();
		if (this.identity !== this.contextKey(context)) throw new Error("JS Notebook session changed; start a new cell");
		if (this.running >= MAX_CELLS || this.cells.size >= 32) throw new Error("JS Notebook has too many active or uncollected cells; wait for or terminate earlier cells");
		const parsed = parseExecSource(source, { allowIsolated: true });
		const cell = new NotebookCell({ id: `js-${randomUUID()}`, source: parsed.code, context, maxOutputTokens: parsed.maxOutputTokens ?? 10000 });
		cell.context = { ...context, setBlocked: (id, active) => cell.setBlocked(id, active) };
		const execution: Execution = { cell, isolated: parsed.isolated, done: Promise.resolve() };
		const definitions = tools.map(tool => ({ name: tool.name, exposed: codeModeGlobalName(tool.name), ...(isCodeModeToolDiscoverable(tool) ? { description: formatCodeModeToolHelp(tool) } : {}), ...("textOutput" in tool && tool.textOutput ? { output: tool.textOutput } : {}) }));
		this.latestTools = definitions;
		this.cells.set(cell.id, execution); this.running++;
		this.delegate.bindCell(cell.id, cell.context, new Map(tools.map(tool => [tool.name, tool])));
		const abort = () => { void this.stop(execution); };
		signal?.addEventListener("abort", abort, { once: true });
		const run = () => this.run(execution, definitions);
		execution.done = (execution.isolated ? run() : this.liveQueue.then(run)).finally(() => signal?.removeEventListener("abort", abort));
		if (!execution.isolated) this.liveQueue = execution.done;
		return this.observe(execution, directToolYieldTime(parsed.code, tools) ?? parsed.yieldTimeMs ?? DEFAULT_CODE_MODE_EXEC_YIELD_MS, signal);
	}
	async wait(id: string, yieldTimeMs: number, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		await this.prepare(context, false, signal);
		const execution = this.cells.get(id);
		if (!execution) return { kind: "result", cellId: id, contentItems: [], missingCell: true };
		execution.cell.context = { ...context, setBlocked: (key, active) => execution.cell.setBlocked(key, active) };
		this.delegate.updateCellContext(id, execution.cell.context);
		const abort = () => { void this.stop(execution); };
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
		void execution.done.then(() => signal?.removeEventListener("abort", abort));
		return this.observe(execution, yieldTimeMs, signal);
	}
	async terminate(id: string, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		signal?.throwIfAborted(); await this.prepare(context, false, signal);
		const execution = this.cells.get(id);
		if (!execution) return { kind: "terminated", cellId: id, contentItems: [], missingCell: true };
		await this.stop(execution); return this.response(execution, "terminated");
	}
	async checkpoint(): Promise<void> {
		await this.liveQueue;
		await this.transaction(async () => { if (this.storage && !this.unavailable && !this.startupError) await this.storage.withLock(async () => { await this.refreshProject(); await this.capture(); }); });
	}
	clearOpaqueResults(): void { this.delegate.clearOpaqueResults(); }
	async shutdown(): Promise<void> {
		this.runtimeAbort.abort();
		this.closing ??= (async () => { await this.preparing; await this.stopSession(); })();
		try { await this.closing; } finally { this.closing = undefined; this.runtimeAbort = new AbortController(); }
	}
	async controlNotebook(request: NotebookControlRequest, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		signal?.throwIfAborted(); await this.prepare(context, request.action === "status" || request.action === "diagnostics", signal);
		if (request.action === "status" || request.action === "diagnostics") return (async () => {
			if (!this.running && !this.managing && !this.unavailable && !this.startupError) {
				this.inspection ??= (async () => {
					this.kernel ??= await this.createKernel(this.liveBudget(), this.durable, false, signal);
					const result = await this.kernel.execute({ tools: this.latestTools, inspect: "*" }, NO_TOOLS);
					if (result.error !== undefined) throw new Error(result.error);
					this.recordInventory(result);
				})();
				const inspection = this.inspection;
				try { await inspection; } finally { if (this.inspection === inspection) this.inspection = undefined; }
			}
			return this.status(request.action === "status" ? request.query : undefined);
		})();
		await this.inspection;
		if (request.action === "list") { const profiles = await this.requireStorage().list(request.query); return { message: JSON.stringify({ profiles }), details: { mode: "js", profiles } }; }
		if (request.action === "restart" || request.action === "reset") await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
		return this.transaction(() => this.requireStorage().withLock(async () => {
			signal?.throwIfAborted();
			if (request.action !== "restart" && request.action !== "reset" && !(request.action === "load" && !await this.requireDataStorage().readProfile(request.name))) await this.refreshProject(signal);
			if (request.action === "restart" || request.action === "reset") {
				await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
				await this.kernel?.stop(); this.kernel = undefined;
				if (request.action === "reset") { await this.requireStorage().reset(); this.durable = undefined; }
				else this.durable = await this.requireStorage().read();
				this.dirty = false; this.startupError = undefined; this.observedProject = emptyState(); this.pins = []; this.hooks = []; this.projectWarning = undefined;
				try { await this.restoreInitial(signal); } catch (error) {
					if (signal?.aborted || this.runtimeAbort.signal.aborted || error instanceof RuntimeInstallError) this.identity = undefined;
					else this.startupError = error instanceof Error ? error.message : String(error);
					throw error;
				}
				this.bindings = []; this.inventoryComplete = this.durable?.inventory?.complete ?? !this.durable;
				this.unavailable = false;
				return { message: request.action === "reset" ? "JS Notebook project reset; project pins and named profiles remain" : "JS Notebook will resume from its last checkpoint; later changes were discarded. Tool and file effects were not rolled back", details: { mode: "js", action: request.action } };
			}
			this.assertReady();
			if (this.running) throw new Error("Wait for active JS Notebook cells before changing saved state");
			if (request.action === "hook") {
				await this.mutate({ hook: { name: request.name, event: request.event } });
				return this.managedResult(request.event === false ? `Removed hook ${request.name}` : `Registered ${request.name} for ${request.event}`, { hooks: this.hooks });
			}
			if (request.action === "pin" || request.action === "unpin" || request.action === "release" || request.action === "prune") {
				if (request.action === "pin" && (request.hook !== undefined || request.checkpoint !== undefined)) throw new Error("Use notebook hook for JS hooks; pins support plain data only");
				const current = await this.liveSnapshot();
				const names = request.action === "prune" ? (current.bindings ?? []).filter(binding => globMatcher(request.query)(binding.name)).map(binding => binding.name) : request.names;
				const result = await this.mutate({ data: { action: request.action === "prune" ? "release" : request.action, names } }, current.snapshot);
				return this.managedResult(result.release ? `${JSON.stringify(result.release)}${result.release.legacyRetained.length ? "\nNames released; values from older checkpoints can remain in the old native scope." : ""}\nOther aliases and closures are retained.` : `${request.action === "pin" ? "Pinned" : "Unpinned"} ${names.join(", ")}`, { pins: this.pins, ...(result.release ? { release: result.release } : {}) });
			}
			if (request.action === "load") {
				const selected = await this.requireDataStorage().readProfile(request.name);
				if (selected) {
					await this.mutate({ data: { action: "import", state: forkPortableState(selected) } });
					return this.managedResult(`Loaded selected data from ${request.name}; existing bindings were preserved`, { action: "load", name: request.name });
				}
				const saved = await this.requireStorage().read(request.name);
				if (!saved) throw new Error("JS Notebook profile is unavailable");
				if (saved.observedProject && saved.observedProject.key !== this.requireDataStorage().projectKey) throw new Error("This isolated candidate belongs to a different project; save a whole-notebook profile there before loading it here");
				if (saved.projectRevision && saved.projectRevision !== (await this.requireStorage().read())?.projectRevision) {
					const recovery = { ...saved }; delete recovery.projectRevision;
					const name = `recovery-${randomUUID()}`;
					await this.requireStorage().write(recovery, name);
					throw new Error(`The project notebook changed since this isolated candidate started; it was not loaded. To deliberately replace the current notebook with this candidate, load ${name}`);
				}
				const candidate = await this.createKernel(this.liveBudget(), saved, false, signal);
				try {
					const result = await candidate.execute({ tools: this.latestTools }, NO_TOOLS);
					if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "The saved notebook could not be restored");
					const snapshot = { ...result.snapshot, observedProject: saved.observedProject ?? { key: this.requireDataStorage().projectKey, state: emptyState() } };
					await this.requireStorage().write(snapshot);
					await this.kernel?.stop(); this.kernel = candidate; this.durable = snapshot; this.dirty = false; this.observedProject = snapshot.observedProject.state; this.unavailable = false;
					this.recordInventory(result);
					await this.syncProject(result);
				} catch (error) { await candidate.stop(); throw error; }
				return this.managedResult(`Loaded ${request.name}; the entire JS Notebook state was replaced`, { action: "load", name: request.name });
			}
			if (request.action === "checkpoint" || request.action === "save") {
				if (request.action === "save" && request.names) {
					if (this.unavailable) throw new Error("JS Notebook stopped; restart before saving");
					this.kernel ??= await this.createKernel(this.liveBudget(), this.durable, false, signal);
					const result = await this.kernel.execute({ tools: this.latestTools, data: { action: "export", names: request.names } }, NO_TOOLS);
					if (result.error !== undefined || !result.data) throw new Error(result.error ?? "Selected JS data could not be saved");
					await this.requireDataStorage().writeProfile(request.name, result.data);
					return { message: `Saved selected JS data as ${request.name}`, details: { mode: "js", names: request.names } };
				}
				const snapshot = await this.capture();
				if (request.action === "save") { const profile = { ...snapshot, pins: [] }; delete profile.observedProject; delete profile.projectRevision; await this.requireStorage().write(profile, request.name); }
				return this.managedResult(request.action === "save" ? `Saved complete JS Notebook as ${request.name}; project pin registrations are not included` : "JS Notebook checkpoint saved", { action: request.action, checkpointBytes: snapshot.bytes.length });
			}
			throw new Error("This JS Notebook control is unavailable. Call notebook for supported actions");
		}, signal));
	}

	private async prepare(context: ToolExecutionContext, inspectionOnly = false, signal?: AbortSignal): Promise<void> {
		if (this.closing) throw new Error("JS Notebook is shutting down");
		signal = signal ? AbortSignal.any([signal, this.runtimeAbort.signal]) : this.runtimeAbort.signal;
		const identity = this.contextKey(context);
		const preparing = this.preparing.then(async () => {
			signal?.throwIfAborted();
			if (this.closing) throw new Error("JS Notebook is shutting down");
			if (identity === this.identity && (!this.inspectionOnly || inspectionOnly)) return;
			await this.stopSession();
			this.storage = new JsStateStorage(this.options.agentDir, context.cwd, identity, this.liveBudget() * 2);
			this.dataStorage = new JsDataStorage(this.options.agentDir, context.cwd, this.liveBudget() * 2);
			this.identity = identity; this.inspectionOnly = inspectionOnly;
			try {
				if (inspectionOnly) { this.durable = await this.requireStorage().read(); if (this.durable) await this.restoreInitial(signal); return; }
				await this.storage.withLock(async () => {
					if (await this.requireStorage().migrateLegacy()) this.migrationNotice = "Resumed this conversation’s previous notebook as the shared project notebook";
					this.durable = await this.requireStorage().read();
					if (!this.durable && this.options.profile) {
						const selected = await this.requireDataStorage().readProfile(this.options.profile);
						if (selected) {
							this.kernel = await this.createKernel(this.liveBudget(), undefined, false, signal);
							const result = await this.kernel.execute({ tools: [], data: { action: "import", state: forkPortableState(selected) } }, NO_TOOLS);
							if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "JS data profile could not be restored");
							this.durable = result.snapshot;
						} else this.durable = await this.requireStorage().read(this.options.profile);
						if (this.durable) { this.durable = { ...this.durable, pins: [] }; delete this.durable.observedProject; await this.requireStorage().write(this.durable); }
					}
					await this.restoreInitial(signal);
				}, signal);
			} catch (error) {
				if (signal?.aborted || this.runtimeAbort.signal.aborted || error instanceof RuntimeInstallError || error instanceof Error && error.message.startsWith("Another conversation is using")) { this.identity = undefined; throw error; }
				this.startupError = error instanceof Error ? error.message : String(error);
			}
		});
		this.preparing = preparing.catch(() => {}); await preparing;
	}
	private async refreshProject(signal?: AbortSignal): Promise<void> {
		const latest = await this.requireStorage().read(undefined, this.durable);
		if (latest?.projectRevision === this.durable?.projectRevision) return;
		if (this.dirty && this.kernel && !this.unavailable) {
			const recovery = await this.liveSnapshot();
			const name = `recovery-${randomUUID()}`;
			await this.requireStorage().write(recovery.snapshot, name);
			throw new Error(`Another conversation updated this project notebook. Your live changes remain here and were saved as ${name}; restart to use the shared state, or explicitly load that profile to replace it`);
		}
		await this.kernel?.stop(); this.kernel = undefined;
		this.durable = latest; this.bindings = []; this.hooks = []; this.pins = [];
		this.unavailable = false; this.startupError = undefined;
		await this.restoreInitial(signal);
	}
	private async stopSession(): Promise<void> {
		await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
		await this.controls;
		// Inspection reports failure to its caller; teardown still owns the kernel.
		await this.inspection?.catch(() => {}); await this.kernel?.stop();
		this.dirty = false; this.inspectionOnly = false; this.migrationNotice = undefined; this.kernel = undefined; this.identity = undefined; this.storage = undefined; this.dataStorage = undefined; this.durable = undefined;
		this.observedProject = emptyState(); this.pins = []; this.projectWarning = undefined;
		this.startupError = undefined; this.unavailable = false; this.heapBytes = 0;
		this.cells.clear(); this.delegate.clear(); this.latestTools = [];
		this.bindings = []; this.inventoryComplete = true; this.hooks = [];
	}
	private contextKey(context: ToolExecutionContext): string {
		if (!context.extensionContext) throw new Error("JS Notebook requires an extension session context");
		return JSON.stringify([context.cwd, notebookSessionIdentity(context.extensionContext)]);
	}
	private assertReady(): void { if (this.closing) throw new Error("JS Notebook is shutting down"); if (this.startupError) throw new Error(this.startupError); }
	private requireStorage(): JsStateStorage { if (!this.storage) throw new Error("JS Notebook session is unavailable"); return this.storage; }
	private requireDataStorage(): JsDataStorage { if (!this.dataStorage) throw new Error("JS Notebook project is unavailable"); return this.dataStorage; }
	private liveBudget(): number { return Math.floor(this.options.maxHeapMiB * 1024 * 1024 / 2); }
	private transaction<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.controls.then(async () => { this.managing++; try { return await operation(); } finally { this.managing--; } }); this.controls = result.then(() => {}, () => {}); return result;
	}
	private status(query = "*"): NotebookControlResult {
		const activeCells = [...this.cells.values()].filter(execution => !execution.cell.isCompleted()).map(execution => execution.cell.id);
		const matches = this.bindings.filter(binding => globMatcher(query)(binding.name));
		const bindings = matches.slice(0, 256);
		const startupStatus = this.startupError ?? (this.unavailable ? "JS Notebook stopped; use notebook restart to restore its checkpoint" : [
			`JS state: ${this.bindings.length} known bindings`,
			...(this.migrationNotice ? [this.migrationNotice] : []),
			...bindings.map(binding => `${binding.name}: ${binding.kind} (${binding.type})`),
			...(matches.length > bindings.length ? ["Binding list truncated; narrow the status query"] : []),
			...(this.inventoryComplete ? [] : ["This older checkpoint predates binding tracking; earlier names still exist but are not listed"]),
			...(activeCells.length ? ["Inventory is from the last completed cell"] : []),
		].join("\n"));
		const details = { mode: "js", startupStatus, bindings, hooks: this.hooks, pins: this.pins, projectWarning: this.projectWarning, retainedBindings: this.bindings.length, inventoryComplete: this.inventoryComplete, activeCells, checkpointBytes: this.durable?.bytes.length ?? 0, heapBytes: this.heapBytes, ...(this.startupError ? { error: this.startupError } : {}) };
		return { message: JSON.stringify(details), details };
	}
	private recordInventory(result: JsOutcome): void {
		if (result.pins) this.pins = result.pins;
		if (result.hooks) this.hooks = result.hooks;
		if (result.bindings) this.bindings = result.bindings;
		if (result.inventoryComplete !== undefined) this.inventoryComplete = result.inventoryComplete;
		this.heapBytes = result.heapBytes;
	}
	private async capture(): Promise<JsSnapshot> {
		const result = await this.liveSnapshot(false);
		await this.commit(result); return this.durable!;
	}
	private async liveSnapshot(management = true): Promise<JsOutcome & { snapshot: JsSnapshot }> {
		if (this.unavailable) throw new Error("JS Notebook stopped; restart before changing saved state");
		this.kernel ??= await this.createKernel(this.liveBudget(), this.durable);
		const result = await this.kernel.execute({ tools: this.latestTools, management }, NO_TOOLS);
		if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "JS Notebook checkpoint failed");
		return { ...result, snapshot: result.snapshot };
	}
	private async mutate(input: Pick<JsInput, "data" | "hook">, snapshot?: JsSnapshot): Promise<JsOutcome> {
		const before = snapshot ?? (await this.liveSnapshot()).snapshot;
		const candidate = await this.createKernel(this.liveBudget(), before, true);
		let adopted = false;
		try {
			const result = await candidate.execute({ tools: this.latestTools, ...input }, NO_TOOLS);
			if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "JS Notebook state change failed");
			await this.commit(result);
			await this.kernel?.stop(); this.kernel = candidate; adopted = true;
			return result;
		} finally { if (!adopted) await candidate.stop(); }
	}
	private async restoreInitial(signal?: AbortSignal): Promise<void> {
		const storage = this.requireDataStorage();
		if (this.durable) {
			if (this.durable.observedProject && this.durable.observedProject.key !== storage.projectKey) throw new Error("Saved JS Notebook project differs from this session; use a named whole-notebook profile to transfer state");
			this.observedProject = this.durable.observedProject?.state ?? emptyState(); this.pins = this.durable.pins ?? [];
			return;
		}
		const project = await storage.readProject(); this.observedProject = project;
		const candidate = await this.createKernel(this.liveBudget(), undefined, false, signal);
		try {
			const result = await candidate.execute({ tools: [], management: true, ...(project.pins.length ? { data: { action: "import" as const, state: project, pins: project.pins } } : {}) }, NO_TOOLS);
			if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "Project pins could not be restored");
			signal?.throwIfAborted();
			await this.commit(result, false); this.kernel = candidate;
		} catch (error) { await candidate.stop(); throw error; }
	}
	private async commit(result: JsOutcome, sync = true): Promise<void> {
		if (!result.snapshot) throw new Error("JS Notebook checkpoint is unavailable");
		const snapshot = { ...result.snapshot, observedProject: { key: this.requireDataStorage().projectKey, state: this.observedProject } };
		await this.requireStorage().write(snapshot); this.durable = snapshot; this.dirty = false; this.recordInventory(result);
		if (sync) await this.syncProject(result);
	}
	private async syncProject(result: JsOutcome): Promise<void> {
		this.projectWarning = undefined;
		try {
			if (result.pinError) throw new Error(result.pinError);
			if (!this.pins.length && !this.observedProject.pins.length) return;
			const candidate = result.pinState ?? emptyState();
			await this.requireDataStorage().writeProject(candidate);
			this.observedProject = candidate;
			if (this.durable) { this.durable = { ...this.durable, observedProject: { key: this.requireDataStorage().projectKey, state: candidate } }; await this.requireStorage().write(this.durable); }
		} catch (error) { this.projectWarning = `Project checkpoint saved, but reset-survival pins were not fully synchronized: ${error instanceof Error ? error.message : String(error)}`; }
	}
	private managedResult(message: string, details: Record<string, unknown>): NotebookControlResult {
		if (this.projectWarning) throw new Error(`${message}\n${this.projectWarning}`);
		return { message, details: { mode: "js", ...details } };
	}
	private async run(execution: Execution, tools: JsTool[]): Promise<void> {
		try {
			if (execution.isolated) {
				let baseline: JsSnapshot | undefined;
				await this.requireStorage().withLock(async () => {
					await this.refreshProject(execution.cell.controller.signal); baseline = this.durable;
				}, execution.cell.controller.signal);
				await this.runCell(execution, tools, baseline);
			} else await this.requireStorage().withLock(async () => {
				await this.refreshProject(execution.cell.controller.signal);
				await this.runCell(execution, tools);
			}, execution.cell.controller.signal);
		} catch (error) {
			execution.cell.result = { status: "error", items: [], errorText: error instanceof Error ? error.message : String(error) };
			this.delegate.cancelCell(execution.cell.id); this.running--; execution.cell.markCompleted();
		}
	}

	private async runCell(execution: Execution, tools: JsTool[], baseline?: JsSnapshot): Promise<void> {
		const { cell, isolated } = execution;
		try {
			cell.controller.signal.throwIfAborted();
			if (!isolated && this.unavailable) throw new Error("The live notebook stopped; use notebook restart");
			if (!isolated && this.migrationNotice) { cell.emit([{ type: "input_text", text: this.migrationNotice }]); this.migrationNotice = undefined; }
			execution.kernel = isolated ? await this.createKernel(Math.floor(this.liveBudget() / MAX_CELLS), baseline, false, cell.controller.signal) : this.kernel ?? await this.createKernel(this.liveBudget(), this.durable, false, cell.controller.signal);
			if (cell.controller.signal.aborted) { await execution.kernel.stop(); cell.controller.signal.throwIfAborted(); }
			if (!isolated) this.kernel = execution.kernel;
			const result = await execution.kernel.execute({ source: cell.source, tools }, {
				output: items => cell.emit(items), notify: text => this.delegate.notifyDirect(cell.id, text), yield: () => cell.requestYield(),
				request: (id, name, input) => this.delegate.invokeDirect(cell.id, id, name, input),
			}).catch(error => { if (!isolated) this.unavailable = true; throw error; });
			cell.controller.signal.throwIfAborted();
			if (!isolated) { this.dirty = true; this.recordInventory(result); }
			if (result.fatal) { if (!isolated) this.unavailable = true; await execution.kernel.stop(); }
			if (result.error !== undefined) throw new Error(result.error || "The cell failed with an empty error message");
			if (!result.snapshot) throw new Error("The cell finished without a checkpoint");
			try {
				if (isolated) {
					const name = `candidate-${cell.id}`;
					await this.requireStorage().write({ ...result.snapshot, ...(baseline?.projectRevision ? { projectRevision: baseline.projectRevision } : {}), observedProject: baseline?.observedProject ?? { key: this.requireDataStorage().projectKey, state: emptyState() } }, name);
					cell.emit([{ type: "input_text", text: `Isolated state saved as ${name}; the live notebook was not changed. Loading it replaces the entire live notebook.` }]);
				} else await this.commit(result);
			} catch (cause) { throw new Error(`The cell finished, but its checkpoint was not saved: ${cause instanceof Error ? cause.message : String(cause)}`); }
			if (!isolated && this.projectWarning) throw new Error(this.projectWarning);
			cell.result = { status: "ok", items: [] };
		} catch (error) {
			cell.result = { status: "error", items: [], errorText: `${error instanceof Error ? error.message : String(error)}\n${isolated ? "Isolated state was not adopted." : this.unavailable ? "Use notebook restart to restore the last checkpoint; later changes were lost." : "Earlier live mutations may remain; no rollback occurred."} Tool and file effects were not rolled back.` };
		} finally {
			this.delegate.cancelCell(cell.id);
			if (isolated || this.unavailable) await execution.kernel?.stop();
			this.running--; cell.markCompleted();
		}
	}
	private async stop(execution: Execution): Promise<void> {
		if (execution.cell.isCompleted()) return;
		execution.stopping ??= (async () => {
			execution.cell.terminated = true; execution.cell.controller.abort(); this.delegate.cancelCell(execution.cell.id);
			if (!execution.isolated && execution.kernel) this.unavailable = true;
			await execution.kernel?.stop(); await execution.done;
		})();
		await execution.stopping;
	}
	private async observe(execution: Execution, ms: number, signal?: AbortSignal): Promise<RuntimeResponse> {
		const kind = await execution.cell.observe(ms, signal);
		if (kind === "result") await execution.cell.waitForCompletion();
		return this.response(execution, kind);
	}
	private response(execution: Execution, kind: RuntimeResponse["kind"]): RuntimeResponse {
		const cell = execution.cell;
		const response: RuntimeResponse = { kind, cellId: cell.id, contentItems: cell.takeContent(), maxOutputTokens: cell.maxOutputTokens, ...(kind === "result" && cell.result?.errorText ? { errorText: cell.result.errorText } : {}) };
		const attached = this.delegate.attach(response);
		if (kind !== "yielded") { this.cells.delete(cell.id); this.delegate.closeCell(cell.id); }
		return attached;
	}
}
