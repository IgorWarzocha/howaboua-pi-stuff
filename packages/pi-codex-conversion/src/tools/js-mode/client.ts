import { randomUUID } from "node:crypto";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../code-mode/custom-tool-prompt.ts";
import { DEFAULT_CODE_MODE_EXEC_YIELD_MS, parseExecSource } from "../code-mode/host-protocol.ts";
import type { CodeModeClientOptions, CodeModeExecutionClient } from "../code-mode/shared-runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type { CodeModeToolDefinition, RuntimeResponse, ToolExecutionContext } from "../code-mode/types.ts";
import { NotebookCell } from "../notebook-mode/cell.ts";
import { notebookSessionIdentity } from "../notebook-mode/session-identity.ts";
import { JsKernel } from "./kernel.ts";
import { loadJsRuntime, type JsRuntime } from "./runtime.ts";
import type { JsTool } from "./protocol.ts";

interface Execution { cell: NotebookCell; kernel?: JsKernel; done: Promise<void>; stopping?: Promise<void> }
const MAX_CELLS = 4;

/** Owns admission and delegate lifetime; workers retain no user VM between executions. */
export class JsCodeClient implements CodeModeExecutionClient {
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly cells = new Map<string, Execution>();
	private readonly idle: JsKernel[] = [];
	private runtime: Promise<JsRuntime> | undefined;
	private running = 0;
	private closing: Promise<void> | undefined;
	private startup = new AbortController();
	private identity: string | undefined;
	private readonly stored = new Map<string, string>();
	private readonly options: CodeModeClientOptions;

	constructor(options: CodeModeClientOptions, renderStore?: CodeModeNestedRenderStore) {
		this.options = options;
		if (process.versions["bun"]) throw new Error("QuickJS Code requires a Node.js Pi host; start Pi with Node.js. Code remains available");
		if (!Number.isSafeInteger(options.maxHeapMiB) || options.maxHeapMiB < 128) throw new Error("QuickJS Code requires a heap budget of at least 128 MiB");
		this.delegate = new CodeModeDelegateRuntime(() => {}, options.prepareToolInput, renderStore);
	}

	async execute(source: string, context: ToolExecutionContext, signal?: AbortSignal, tools: CodeModeToolDefinition[] = []): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		if (this.closing) throw new Error("QuickJS Code is shutting down");
		this.bindContext(context);
		if (this.running >= MAX_CELLS || this.cells.size >= 32) throw new Error("QuickJS Code has too many active or uncollected cells; wait for or terminate earlier cells");
		const parsed = parseExecSource(source);
		const cell = new NotebookCell({ id: `js-${randomUUID()}`, source: parsed.code, context, maxOutputTokens: parsed.maxOutputTokens ?? 10000 });
		cell.context = { ...context, setBlocked: (id, active) => cell.setBlocked(id, active) };
		const execution: Execution = { cell, done: Promise.resolve() };
		const definitions: JsTool[] = tools.map(tool => ({ name: tool.name, exposed: codeModeGlobalName(tool.name), ...(isCodeModeToolDiscoverable(tool) ? { description: formatCodeModeToolHelp(tool) } : {}), ...("textOutput" in tool && tool.textOutput ? { output: tool.textOutput } : {}) }));
		this.cells.set(cell.id, execution); this.running++;
		this.delegate.bindCell(cell.id, cell.context, new Map(tools.map(tool => [tool.name, tool])));
		const abort = () => { void this.stop(execution); };
		signal?.addEventListener("abort", abort, { once: true });
		execution.done = this.run(execution, definitions).finally(() => signal?.removeEventListener("abort", abort));
		return this.observe(execution, directToolYieldTime(parsed.code, tools) ?? parsed.yieldTimeMs ?? DEFAULT_CODE_MODE_EXEC_YIELD_MS, signal);
	}
	async wait(id: string, yieldTimeMs: number, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		this.bindContext(context);
		const execution = this.cells.get(id);
		if (!execution) return { kind: "result", cellId: id, contentItems: [], missingCell: true };
		execution.cell.context = { ...context, setBlocked: (key, active) => execution.cell.setBlocked(key, active) };
		this.delegate.updateCellContext(id, execution.cell.context);
		const abort = () => { void this.stop(execution); };
		if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
		void execution.done.then(() => signal?.removeEventListener("abort", abort));
		return this.observe(execution, yieldTimeMs, signal);
	}
	async terminate(id: string, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		this.bindContext(context);
		const execution = this.cells.get(id);
		if (!execution) return { kind: "terminated", cellId: id, contentItems: [], missingCell: true };
		await this.stop(execution); return this.response(execution, "terminated");
	}
	clearOpaqueResults(): void { this.delegate.clearOpaqueResults(); }
	async shutdown(): Promise<void> {
		if (!this.closing) {
			this.startup.abort();
			this.closing = (async () => {
				await Promise.all([...this.cells.values()].map(execution => this.stop(execution)));
				await Promise.all(this.idle.splice(0).map(kernel => kernel.stop()));
				this.cells.clear(); this.delegate.clear(); this.runtime = undefined;
				this.stored.clear(); this.identity = undefined;
			})();
		}
		try { await this.closing; } finally { this.closing = undefined; this.startup = new AbortController(); }
	}

	private async run(execution: Execution, tools: JsTool[]): Promise<void> {
		const { cell } = execution;
		try {
			this.runtime ??= loadJsRuntime(this.options.agentDir, this.startup.signal).catch(error => { this.runtime = undefined; throw error; });
			const runtime = await this.runtime;
			cell.controller.signal.throwIfAborted();
			execution.kernel = this.idle.pop() ?? JsKernel.create(runtime, this.options.maxHeapMiB * 1024 * 1024);
			const result = await execution.kernel.execute({ source: cell.source, tools, store: Object.fromEntries(this.stored) }, {
				output: items => cell.emit(items), notify: text => this.delegate.notifyDirect(cell.id, text), yield: () => cell.requestYield(),
				store: (key, json) => this.writeStore(key, json),
				request: (id, name, input) => this.delegate.invokeDirect(cell.id, id, name, input),
			});
			cell.controller.signal.throwIfAborted();
			if (result.error !== undefined) throw new Error(result.error || "The cell failed with an empty error message");
			cell.result = { status: "ok", items: [] };
		} catch (error) {
			cell.result = { status: "error", items: [], errorText: error instanceof Error ? error.message : String(error) };
		} finally {
			this.delegate.cancelCell(cell.id);
			if (execution.kernel) {
				if (cell.controller.signal.aborted || !execution.kernel.reusable) await execution.kernel.stop();
				else this.idle.push(execution.kernel);
			}
			this.running--; cell.markCompleted();
		}
	}
	private bindContext(context: ToolExecutionContext): void {
		if (!context.extensionContext) throw new Error("QuickJS Code requires an extension session context");
		const identity = JSON.stringify([context.cwd, notebookSessionIdentity(context.extensionContext)]);
		if (this.identity === identity) return;
		if (this.cells.size) throw new Error("QuickJS Code session changed; close earlier cells before starting this conversation");
		this.stored.clear(); this.delegate.clear(); this.identity = identity;
	}
	private writeStore(key: string, json?: string): void {
		let size = json === undefined ? 0 : key.length + json.length;
		for (const [name, value] of this.stored) if (name !== key) size += name.length + value.length;
		if (size > 1024 * 1024) throw new Error("Store is full; delete keys with store(key, undefined)");
		if (json === undefined) this.stored.delete(key); else this.stored.set(key, json);
	}
	private async stop(execution: Execution): Promise<void> {
		if (execution.cell.isCompleted()) return;
		execution.stopping ??= (async () => {
			execution.cell.terminated = true; execution.cell.controller.abort(); this.delegate.cancelCell(execution.cell.id);
			await execution.kernel?.stop(); await execution.done;
		})();
		await execution.stopping;
	}
	private async observe(execution: Execution, ms: number, signal?: AbortSignal): Promise<RuntimeResponse> {
		const kind = await execution.cell.observe(ms, signal);
		return this.response(execution, kind);
	}
	private response(execution: Execution, kind: RuntimeResponse["kind"]): RuntimeResponse {
		const cell = execution.cell;
		const attached = this.delegate.attach({ kind, cellId: cell.id, contentItems: cell.takeContent(), maxOutputTokens: cell.maxOutputTokens, ...(kind === "result" && cell.result?.errorText ? { errorText: cell.result.errorText } : {}) });
		if (kind !== "yielded") { this.cells.delete(cell.id); this.delegate.closeCell(cell.id); }
		return attached;
	}
}
