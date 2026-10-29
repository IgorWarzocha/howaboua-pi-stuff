import { randomUUID } from "node:crypto";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../code-mode/custom-tool-prompt.ts";
import { DEFAULT_CODE_MODE_EXEC_YIELD_MS, parseExecSource } from "../code-mode/host-protocol.ts";
import type { CodeModeExecutionClient, NotebookClientOptions } from "../code-mode/shared-runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type { CodeModeToolDefinition, NotebookControlRequest, NotebookControlResult, RuntimeResponse, ToolExecutionContext } from "../code-mode/types.ts";
import { NotebookCell } from "../notebook-mode/cell.ts";
import { notebookSessionIdentity } from "../notebook-mode/session-identity.ts";
import type { JsKernel } from "./kernel.ts";
import { RuntimeInstallError } from "../code-mode/runtime-package.ts";
import type { JsSnapshot, JsTool } from "./protocol.ts";
import { JsNotebookProject } from "./project.ts";

interface Execution { cell: NotebookCell; isolated: boolean; kernel?: JsKernel; done: Promise<void>; stopping?: Promise<void> }
const MAX_CELLS = 4;

export class JsNotebookClient implements CodeModeExecutionClient {
	private readonly project: JsNotebookProject;
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly cells = new Map<string, Execution>();
	private identity: string | undefined;
	private inspectionOnly = false;
	private inspection: Promise<void> | undefined;
	private managing = 0;
	private preparing: Promise<void> = Promise.resolve();
	private controls: Promise<void> = Promise.resolve();
	private liveQueue: Promise<void> = Promise.resolve();
	private closing: Promise<void> | undefined;
	private running = 0;

	constructor(options: NotebookClientOptions, renderStore?: CodeModeNestedRenderStore) {
		if (process.versions["bun"]) throw new Error("JS Notebook requires a Node.js Pi host; start Pi with Node.js. Code and Deno Notebook remain available");
		if (!Number.isSafeInteger(options.maxHeapMiB) || options.maxHeapMiB < 128) throw new Error("JS Notebook requires a Notebook heap budget of at least 128 MiB");
		this.project = new JsNotebookProject(options);
		this.delegate = new CodeModeDelegateRuntime(() => {}, options.prepareToolInput, renderStore);
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
		this.project.setTools(definitions);
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
		await this.transaction(async () => { if (this.project.available && !this.project.error) await this.project.withLock(async () => { await this.project.refreshProject(); await this.project.capture(); }); });
	}
	clearOpaqueResults(): void { this.delegate.clearOpaqueResults(); }
	async shutdown(): Promise<void> {
		this.project.abortStartup();
		this.closing ??= (async () => { await this.preparing; await this.stopSession(); })();
		try { await this.closing; } finally { this.closing = undefined; this.project.renewStartup(); }
	}
	async controlNotebook(request: NotebookControlRequest, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		signal?.throwIfAborted(); await this.prepare(context, request.action === "status" || request.action === "diagnostics", signal);
		if (request.action === "status" || request.action === "diagnostics") return (async () => {
			if (!this.running && !this.managing && !this.project.stopped && !this.project.error) {
				this.inspection ??= this.project.inspect(signal);
				const inspection = this.inspection;
				try { await inspection; } finally { if (this.inspection === inspection) this.inspection = undefined; }
			}
			return this.project.status([...this.cells.values()].filter(execution => !execution.cell.isCompleted()).map(execution => execution.cell.id), request.action === "status" ? request.query : undefined);
		})();
		await this.inspection;
		if (request.action === "list") return this.project.list(request.query);
		if (request.action === "restart" || request.action === "reset") await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
		return this.transaction(() => this.project.withLock(async () => {
			signal?.throwIfAborted();
			if (request.action !== "restart" && request.action !== "reset" && !(request.action === "load" && !await this.project.hasDataProfile(request.name))) await this.project.refreshProject(signal);
			if (request.action === "restart" || request.action === "reset") {
				await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
				return this.project.restart(request.action === "reset", signal, () => { this.identity = undefined; });
			}
			this.assertReady();
			if (this.running) throw new Error("Wait for active JS Notebook cells before changing saved state");
			return this.project.control(request, signal);
		}, signal));
	}

	private async prepare(context: ToolExecutionContext, inspectionOnly = false, signal?: AbortSignal): Promise<void> {
		if (this.closing) throw new Error("JS Notebook is shutting down");
		signal = this.project.startupSignal(signal);
		const identity = this.contextKey(context);
		const preparing = this.preparing.then(async () => {
			signal?.throwIfAborted();
			if (this.closing) throw new Error("JS Notebook is shutting down");
			if (identity === this.identity && (!this.inspectionOnly || inspectionOnly)) return;
			await this.stopSession();
			this.project.bindStorage(context.cwd, identity);
			this.identity = identity; this.inspectionOnly = inspectionOnly;
			try {
				await this.project.initialize(inspectionOnly, signal);
			} catch (error) {
				if (signal?.aborted || this.project.startupAborted || error instanceof RuntimeInstallError || error instanceof Error && error.message.startsWith("Another conversation is using")) { this.identity = undefined; throw error; }
				this.project.recordStartupError(error);
			}
		});
		this.preparing = preparing.catch(() => {}); await preparing;
	}
	private async stopSession(): Promise<void> {
		await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
		await this.controls;
		// Inspection reports failure to its caller; teardown still owns the kernel.
		await this.inspection?.catch(() => {}); await this.project.close();
		this.inspectionOnly = false; this.identity = undefined;
		this.cells.clear(); this.delegate.clear();
	}
	private contextKey(context: ToolExecutionContext): string {
		if (!context.extensionContext) throw new Error("JS Notebook requires an extension session context");
		return JSON.stringify([context.cwd, notebookSessionIdentity(context.extensionContext)]);
	}
	private assertReady(): void { if (this.closing) throw new Error("JS Notebook is shutting down"); if (this.project.error) throw new Error(this.project.error); }
	private transaction<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.controls.then(async () => { this.managing++; try { return await operation(); } finally { this.managing--; } }); this.controls = result.then(() => {}, () => {}); return result;
	}
	private async run(execution: Execution, tools: JsTool[]): Promise<void> {
		try {
			if (execution.isolated) {
				const baseline = await this.project.isolationBaseline();
				await this.runCell(execution, tools, baseline);
			} else await this.project.withLock(async () => {
				await this.project.refreshProject(execution.cell.controller.signal);
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
			if (!isolated && this.project.stopped) throw new Error("The live notebook stopped; use notebook restart");
			if (!isolated) { const notice = this.project.takeMigrationNotice(); if (notice) cell.emit([{ type: "input_text", text: notice }]); }
			execution.kernel = await this.project.cellKernel(isolated, MAX_CELLS, cell.controller.signal, baseline);
			if (cell.controller.signal.aborted) { await execution.kernel.stop(); cell.controller.signal.throwIfAborted(); }
			if (!isolated) this.project.adoptLiveKernel(execution.kernel);
			const result = await execution.kernel.execute({ source: cell.source, tools }, {
				output: items => cell.emit(items), notify: text => this.delegate.notifyDirect(cell.id, text), yield: () => cell.requestYield(),
				request: (id, name, input) => this.delegate.invokeDirect(cell.id, id, name, input),
			}).catch(error => { if (!isolated) this.project.invalidate(); throw error; });
			cell.controller.signal.throwIfAborted();
			if (!isolated) { this.project.recordCell(result); }
			if (result.fatal) { if (!isolated) this.project.invalidate(); await execution.kernel.stop(); }
			if (result.error !== undefined) throw new Error(result.error || "The cell failed with an empty error message");
			if (!result.snapshot) throw new Error("The cell finished without a checkpoint");
			try {
				if (isolated) {
					const name = `candidate-${cell.id}`;
					await this.project.saveCandidate(result.snapshot, name, baseline);
					cell.emit([{ type: "input_text", text: `Isolated state saved as ${name}; the live notebook was not changed. Loading it replaces the entire live notebook.` }]);
				} else await this.project.commit(result);
			} catch (cause) { throw new Error(`The cell finished, but its checkpoint was not saved: ${cause instanceof Error ? cause.message : String(cause)}`); }
			if (!isolated && this.project.warning) throw new Error(this.project.warning);
			cell.result = { status: "ok", items: [] };
		} catch (error) {
			cell.result = { status: "error", items: [], errorText: `${error instanceof Error ? error.message : String(error)}\n${isolated ? "Isolated state was not adopted." : this.project.stopped ? "Use notebook restart to restore the last checkpoint; later changes were lost." : "Earlier live mutations may remain; no rollback occurred."} Tool and file effects were not rolled back.` };
		} finally {
			this.delegate.cancelCell(cell.id);
			if (isolated || this.project.stopped) await execution.kernel?.stop();
			this.running--; cell.markCompleted();
		}
	}
	private async stop(execution: Execution): Promise<void> {
		if (execution.cell.isCompleted()) return;
		execution.stopping ??= (async () => {
			execution.cell.terminated = true; execution.cell.controller.abort(); this.delegate.cancelCell(execution.cell.id);
			if (!execution.isolated && execution.kernel) this.project.invalidate();
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
