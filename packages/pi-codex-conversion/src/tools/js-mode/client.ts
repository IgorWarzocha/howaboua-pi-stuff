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
import { JsStateStorage } from "./storage.ts";
import type { JsBindingStatus, JsOutcome, JsSnapshot, JsTool } from "./protocol.ts";

interface Execution { cell: NotebookCell; isolated: boolean; kernel?: JsKernel; done: Promise<void>; stopping?: Promise<void> }
const MAX_CELLS = 4;
const NO_TOOLS = { output: () => {}, notify: () => {}, yield: () => {}, request: async (): Promise<never> => { throw new Error("Tools are unavailable during checkpoint management"); } };

export class JsNotebookClient implements CodeModeExecutionClient {
	private readonly options: NotebookRuntimeOptions;
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly cells = new Map<string, Execution>();
	private identity: string | undefined;
	private storage: JsStateStorage | undefined;
	private durable: JsSnapshot | undefined;
	private kernel: JsKernel | undefined;
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

	constructor(options: NotebookRuntimeOptions, renderStore?: CodeModeNestedRenderStore) {
		if (process.versions["bun"]) throw new Error("JS Notebook requires a Node.js Pi host; start Pi with Node.js. Code and Deno Notebook remain available");
		if (!Number.isSafeInteger(options.maxHeapMiB) || options.maxHeapMiB < 128) throw new Error("JS Notebook requires a Notebook heap budget of at least 128 MiB");
		this.options = options;
		this.delegate = new CodeModeDelegateRuntime(() => {}, renderStore);
	}

	async execute(source: string, context: ToolExecutionContext, signal?: AbortSignal, tools: CodeModeToolDefinition[] = []): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		await this.prepare(context); await this.controls;
		signal?.throwIfAborted(); this.assertReady();
		if (this.identity !== this.contextKey(context)) throw new Error("JS Notebook session changed; start a new cell");
		if (this.running >= MAX_CELLS || this.cells.size >= 32) throw new Error("JS Notebook has too many active or uncollected cells; wait for or terminate earlier cells");
		const parsed = parseExecSource(source, { allowIsolated: true });
		if (!parsed.isolated && this.unavailable) throw new Error("The JS Notebook kernel stopped; use notebook restart to restore its last checkpoint");
		const cell = new NotebookCell({ id: `js-${randomUUID()}`, source: parsed.code, context, maxOutputTokens: parsed.maxOutputTokens ?? 10000 });
		cell.context = { ...context, setBlocked: (id, active) => cell.setBlocked(id, active) };
		const execution: Execution = { cell, isolated: parsed.isolated, done: Promise.resolve() };
		const definitions = tools.map(tool => ({ name: tool.name, exposed: codeModeGlobalName(tool.name), ...(isCodeModeToolDiscoverable(tool) ? { description: formatCodeModeToolHelp(tool) } : {}), ...("textOutput" in tool && tool.textOutput ? { output: tool.textOutput } : {}) }));
		this.latestTools = definitions;
		const baseline = this.durable;
		this.cells.set(cell.id, execution); this.running++;
		this.delegate.bindCell(cell.id, cell.context, new Map(tools.map(tool => [tool.name, tool])));
		const abort = () => { void this.stop(execution); };
		signal?.addEventListener("abort", abort, { once: true });
		const run = () => this.run(execution, definitions, baseline);
		execution.done = (execution.isolated ? run() : this.liveQueue.then(run)).finally(() => signal?.removeEventListener("abort", abort));
		if (!execution.isolated) this.liveQueue = execution.done;
		return this.observe(execution, directToolYieldTime(parsed.code, tools) ?? parsed.yieldTimeMs ?? DEFAULT_CODE_MODE_EXEC_YIELD_MS, signal);
	}
	async wait(id: string, yieldTimeMs: number, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		await this.prepare(context);
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
		signal?.throwIfAborted(); await this.prepare(context);
		const execution = this.cells.get(id);
		if (!execution) return { kind: "terminated", cellId: id, contentItems: [], missingCell: true };
		await this.stop(execution); return this.response(execution, "terminated");
	}
	async checkpoint(): Promise<void> {
		await this.liveQueue;
		await this.transaction(async () => { if (this.storage && !this.unavailable && !this.startupError) await this.capture(); });
	}
	clearOpaqueResults(): void { this.delegate.clearOpaqueResults(); }
	async shutdown(): Promise<void> {
		this.closing ??= (async () => { await this.preparing; await this.stopSession(); })();
		try { await this.closing; } finally { this.closing = undefined; }
	}
	async controlNotebook(request: NotebookControlRequest, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		signal?.throwIfAborted(); await this.prepare(context);
		if (request.action === "status" || request.action === "diagnostics") return this.transaction(async () => {
			if (!this.running && !this.unavailable && !this.startupError) {
				this.kernel ??= await JsKernel.create(this.liveBudget(), this.durable);
				const result = await this.kernel.execute({ tools: this.latestTools, inspect: "*" }, NO_TOOLS);
				if (result.error !== undefined) throw new Error(result.error);
				this.recordInventory(result);
			}
			return this.status(request.action === "status" ? request.query : undefined);
		});
		if (request.action === "list") { const profiles = await this.requireStorage().list(request.query); return { message: JSON.stringify({ profiles }), details: { mode: "js", profiles } }; }
		return this.transaction(async () => {
			signal?.throwIfAborted();
			if (request.action === "restart" || request.action === "reset") {
				await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
				await this.kernel?.stop(); this.kernel = undefined;
				if (request.action === "reset") { await this.requireStorage().reset(); this.durable = undefined; this.startupError = undefined; }
				else { this.durable = await this.requireStorage().read(); this.startupError = undefined; }
				this.bindings = []; this.inventoryComplete = this.durable?.inventory?.complete ?? !this.durable;
				this.unavailable = false;
				return { message: request.action === "reset" ? "JS Notebook session reset; named profiles remain" : "JS Notebook will resume from its last checkpoint; later changes were discarded. Tool and file effects were not rolled back", details: { mode: "js", action: request.action } };
			}
			this.assertReady();
			if (this.running) throw new Error("Wait for active JS Notebook cells before changing saved state");
			if (request.action === "load") {
				const saved = await this.requireStorage().read(request.name);
				if (!saved) throw new Error("JS Notebook profile is unavailable");
				const candidate = await JsKernel.create(this.liveBudget(), saved);
				try {
					const result = await candidate.execute({ tools: this.latestTools }, NO_TOOLS);
					if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "The saved notebook could not be restored");
					await this.requireStorage().write(result.snapshot);
					await this.kernel?.stop(); this.kernel = candidate; this.durable = result.snapshot; this.unavailable = false; this.heapBytes = result.heapBytes;
					this.recordInventory(result);
				} catch (error) { await candidate.stop(); throw error; }
				return { message: `Loaded ${request.name}; the entire JS Notebook state was replaced`, details: { mode: "js", action: "load", name: request.name } };
			}
			if (request.action === "checkpoint" || request.action === "save") {
				const snapshot = await this.capture();
				if (request.action === "save") await this.requireStorage().write(snapshot, request.name);
				return { message: request.action === "save" ? `Saved complete JS Notebook as ${request.name}` : "JS Notebook checkpoint saved", details: { mode: "js", action: request.action, checkpointBytes: snapshot.bytes.length } };
			}
			throw new Error("JS Notebook saves and restores whole notebooks; per-binding pins, hooks and release are unavailable. Call notebook for supported actions");
		});
	}

	private async prepare(context: ToolExecutionContext): Promise<void> {
		if (this.closing) throw new Error("JS Notebook is shutting down");
		const identity = this.contextKey(context);
		const preparing = this.preparing.then(async () => {
			if (this.closing) throw new Error("JS Notebook is shutting down");
			if (identity === this.identity) return;
			await this.stopSession();
			this.storage = new JsStateStorage(this.options.agentDir, context.cwd, identity, this.liveBudget() * 2);
			this.identity = identity;
			try {
				this.durable = await this.storage.read();
				if (!this.durable && this.options.profile) this.durable = await this.storage.read(this.options.profile);
			} catch (error) { this.startupError = error instanceof Error ? error.message : String(error); }
		});
		this.preparing = preparing.catch(() => {}); await preparing;
	}
	private async stopSession(): Promise<void> {
		await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
		await this.controls; await this.kernel?.stop();
		this.kernel = undefined; this.identity = undefined; this.storage = undefined; this.durable = undefined;
		this.startupError = undefined; this.unavailable = false; this.heapBytes = 0;
		this.cells.clear(); this.delegate.clear(); this.latestTools = [];
		this.bindings = []; this.inventoryComplete = true;
	}
	private contextKey(context: ToolExecutionContext): string {
		if (!context.extensionContext) throw new Error("JS Notebook requires an extension session context");
		return JSON.stringify([context.cwd, notebookSessionIdentity(context.extensionContext)]);
	}
	private assertReady(): void { if (this.closing) throw new Error("JS Notebook is shutting down"); if (this.startupError) throw new Error(this.startupError); }
	private requireStorage(): JsStateStorage { if (!this.storage) throw new Error("JS Notebook session is unavailable"); return this.storage; }
	private liveBudget(): number { return Math.floor(this.options.maxHeapMiB * 1024 * 1024 / 2); }
	private transaction<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.controls.then(operation); this.controls = result.then(() => {}, () => {}); return result;
	}
	private status(query = "*"): NotebookControlResult {
		const activeCells = [...this.cells.values()].filter(execution => !execution.cell.isCompleted()).map(execution => execution.cell.id);
		const matches = this.bindings.filter(binding => globMatcher(query)(binding.name));
		const bindings = matches.slice(0, 256);
		const startupStatus = this.startupError ?? (this.unavailable ? "JS Notebook stopped; use notebook restart to restore its checkpoint" : [
			`JS state: ${this.bindings.length} known bindings`,
			...bindings.map(binding => `${binding.name}: ${binding.kind} (${binding.type})`),
			...(matches.length > bindings.length ? ["Binding list truncated; narrow the status query"] : []),
			...(this.inventoryComplete ? [] : ["This older checkpoint predates binding tracking; earlier names still exist but are not listed"]),
			...(activeCells.length ? ["Inventory is from the last completed cell"] : []),
		].join("\n"));
		const details = { mode: "js", startupStatus, bindings, retainedBindings: this.bindings.length, inventoryComplete: this.inventoryComplete, activeCells, checkpointBytes: this.durable?.bytes.length ?? 0, heapBytes: this.heapBytes, ...(this.startupError ? { error: this.startupError } : {}) };
		return { message: JSON.stringify(details), details };
	}
	private recordInventory(result: JsOutcome): void {
		if (result.bindings) this.bindings = result.bindings;
		if (result.inventoryComplete !== undefined) this.inventoryComplete = result.inventoryComplete;
		this.heapBytes = result.heapBytes;
	}
	private async capture(): Promise<JsSnapshot> {
		if (this.unavailable) throw new Error("JS Notebook stopped; restart before checkpointing");
		this.kernel ??= await JsKernel.create(this.liveBudget(), this.durable);
		const result = await this.kernel.execute({ tools: this.latestTools }, NO_TOOLS);
		if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "JS Notebook checkpoint failed");
		this.recordInventory(result);
		await this.requireStorage().write(result.snapshot); this.durable = result.snapshot; this.heapBytes = result.heapBytes;
		return result.snapshot;
	}
	private async run(execution: Execution, tools: JsTool[], baseline?: JsSnapshot): Promise<void> {
		const { cell, isolated } = execution;
		try {
			cell.controller.signal.throwIfAborted();
			if (!isolated && this.unavailable) throw new Error("The live notebook stopped; use notebook restart");
			execution.kernel = isolated ? await JsKernel.create(Math.floor(this.liveBudget() / MAX_CELLS), baseline) : this.kernel ?? await JsKernel.create(this.liveBudget(), this.durable);
			if (cell.controller.signal.aborted) { await execution.kernel.stop(); cell.controller.signal.throwIfAborted(); }
			if (!isolated) this.kernel = execution.kernel;
			const result = await execution.kernel.execute({ source: cell.source, tools }, {
				output: items => cell.emit(items), notify: text => this.delegate.notifyDirect(cell.id, text), yield: () => cell.requestYield(),
				request: (id, name, input) => this.delegate.invokeDirect(cell.id, id, name, input),
			}).catch(error => { if (!isolated) this.unavailable = true; throw error; });
			cell.controller.signal.throwIfAborted();
			if (!isolated) this.recordInventory(result);
			if (result.fatal) { if (!isolated) this.unavailable = true; await execution.kernel.stop(); }
			if (result.error !== undefined) throw new Error(result.error || "The cell failed with an empty error message");
			if (!result.snapshot) throw new Error("The cell finished without a checkpoint");
			try {
				if (isolated) {
					const name = `candidate-${cell.id}`;
					await this.requireStorage().write(result.snapshot, name);
					cell.emit([{ type: "input_text", text: `Isolated state saved as ${name}; the live notebook was not changed. Loading it replaces the entire live notebook.` }]);
				} else { await this.requireStorage().write(result.snapshot); this.durable = result.snapshot; }
			} catch (cause) { throw new Error(`The cell finished, but its checkpoint was not saved: ${cause instanceof Error ? cause.message : String(cause)}`); }
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
