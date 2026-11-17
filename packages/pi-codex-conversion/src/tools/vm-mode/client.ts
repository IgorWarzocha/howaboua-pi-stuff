import { randomUUID } from "node:crypto";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import {
	formatCodeModeToolHelp,
	isCodeModeToolDiscoverable,
} from "../code-mode/custom-tool-prompt.ts";
import {
	DEFAULT_CODE_MODE_EXEC_YIELD_MS,
	parseExecSource,
} from "../code-mode/host-protocol.ts";
import type {
	CodeModeClientOptions,
	CodeModeExecutionClient,
} from "../code-mode/shared-runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import { NotebookCell } from "../notebook-mode/cell.ts";
import { notebookSessionIdentity } from "../notebook-mode/session-identity.ts";
import { VmKernel } from "./kernel.ts";
import { VM_STORE_TOTAL_MAX, VM_STORE_VALUE_MAX, vmHeapMiB } from "./limits.ts";
import type { VmMemory, VmTool } from "./protocol.ts";

interface Execution {
	cell: NotebookCell;
	kernel?: VmKernel;
	done: Promise<void>;
	stopping?: Promise<void>;
	cooperative: boolean;
	inflight: number;
}

const STALL =
	"VM Code stopped a script that did not finish or yield. Conversation bindings were dropped. The next exec starts fresh";
const RESET = "VM Code reset and dropped conversation bindings";

/** One context for the active conversation. Session changes, terminate, stall and memory limits drop it. */
export class VmCodeClient implements CodeModeExecutionClient {
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly heapMiB: number;
	private kernel: VmKernel | undefined;
	private active: Execution | undefined;
	private identity: string | undefined;
	private readonly stored = new Map<string, string>();
	private closing: Promise<void> | undefined;
	private switching: Promise<void> = Promise.resolve();
	lastMemory: VmMemory | undefined;

	constructor(
		options: CodeModeClientOptions,
		renderStore?: CodeModeNestedRenderStore,
	) {
		if (process.versions["bun"])
			throw new Error(
				"VM Code requires a Node.js Pi host; start Pi with Node.js. Code and QuickJS Code remain available",
			);
		this.heapMiB = vmHeapMiB(options.maxHeapMiB);
		this.delegate = new CodeModeDelegateRuntime(
			() => {},
			options.prepareToolInput,
			renderStore,
		);
	}

	async execute(
		source: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
		tools: CodeModeToolDefinition[] = [],
	): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		if (this.closing) throw new Error("VM Code is shutting down");
		await this.switching;
		this.bindContext(context);
		await this.switching;
		if (this.active?.cell.isCompleted()) {
			this.delegate.closeCell(this.active.cell.id);
			this.active = undefined;
		}
		if (this.active)
			throw new Error(
				"VM Code is still running an exec; wait for it or terminate it",
			);
		const parsed = parseExecSource(source);
		const cell = new NotebookCell({
			id: `vm-${randomUUID()}`,
			source: parsed.code,
			context,
			maxOutputTokens: parsed.maxOutputTokens ?? 10000,
		});
		cell.context = {
			...context,
			setBlocked: (id, blocked) => cell.setBlocked(id, blocked),
		};
		const execution: Execution = {
			cell,
			done: Promise.resolve(),
			cooperative: false,
			inflight: 0,
		};
		this.active = execution;
		const definitions = toolDefinitions(tools);
		this.delegate.bindCell(
			cell.id,
			cell.context,
			new Map(tools.map((tool) => [tool.name, tool])),
		);
		const abort = () => {
			void this.stop(
				execution,
				"VM Code was cancelled and dropped conversation bindings. The next exec starts fresh",
			);
		};
		signal?.addEventListener("abort", abort, { once: true });
		execution.done = this.run(execution, definitions).finally(() =>
			signal?.removeEventListener("abort", abort),
		);
		try {
			return await this.observe(
				execution,
				directToolYieldTime(parsed.code, tools) ??
					parsed.yieldTimeMs ??
					DEFAULT_CODE_MODE_EXEC_YIELD_MS,
				signal,
			);
		} catch (error) {
			if (execution.stopping) await execution.stopping;
			throw error;
		}
	}

	async wait(
		id: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		await this.switching;
		this.bindContext(context);
		const execution = this.active?.cell.id === id ? this.active : undefined;
		if (!execution)
			return {
				kind: "result",
				cellId: id,
				contentItems: [],
				missingCell: true,
			};
		execution.cell.context = {
			...context,
			setBlocked: (key, blocked) => execution.cell.setBlocked(key, blocked),
		};
		this.delegate.updateCellContext(id, execution.cell.context);
		const abort = () => {
			void this.stop(
				execution,
				"VM Code was cancelled and dropped conversation bindings. The next exec starts fresh",
			);
		};
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
		void execution.done.then(() => signal?.removeEventListener("abort", abort));
		return this.observe(execution, yieldTimeMs, signal);
	}

	async terminate(
		id: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		this.bindContext(context);
		const execution = this.active?.cell.id === id ? this.active : undefined;
		if (!execution)
			return {
				kind: "terminated",
				cellId: id,
				contentItems: [],
				missingCell: true,
			};
		await this.stop(execution, RESET);
		return this.response(execution, "terminated");
	}

	clearOpaqueResults(): void {
		this.delegate.clearOpaqueResults();
	}

	async sample(): Promise<VmMemory | undefined> {
		if (!this.kernel || this.kernel.failed) return undefined;
		const memory = await this.kernel.sample();
		this.lastMemory = memory;
		return memory;
	}

	/** Drops the conversation context when nothing is running, or after the running exec is stopped. */
	async reset(): Promise<void> {
		if (this.active && !this.active.cell.isCompleted())
			await this.stop(this.active, RESET);
		await this.drop();
	}

	async shutdown(): Promise<void> {
		if (!this.closing)
			this.closing = this.reset().finally(() => {
				this.delegate.clear();
				this.identity = undefined;
			});
		try {
			await this.closing;
		} finally {
			this.closing = undefined;
		}
	}

	private async run(execution: Execution, tools: VmTool[]): Promise<void> {
		const { cell } = execution;
		try {
			this.kernel ??= VmKernel.create(this.heapMiB);
			execution.kernel = this.kernel;
			cell.controller.signal.throwIfAborted();
			const outcome = await execution.kernel.execute(
				{ source: cell.source, tools, store: Object.fromEntries(this.stored) },
				{
					output: (items) => cell.emit(items),
					notify: (text) => this.delegate.notifyDirect(cell.id, text),
					yield: () => {
						execution.cooperative = true;
						cell.requestYield();
					},
					store: (key, json) => this.writeStore(key, json),
					cancel: () => {
						this.delegate.cancelCell(cell.id);
					},
					request: async (id, name, value) => {
						execution.inflight++;
						cell.setBlocked(`vm-${id}`, true);
						try {
							return await this.delegate.invokeDirect(cell.id, id, name, value);
						} finally {
							execution.inflight--;
							cell.setBlocked(`vm-${id}`, false);
						}
					},
				},
			);
			this.lastMemory = outcome.memory;
			if (execution.kernel.failed)
				throw new Error(
					outcome.error ||
						"VM Code stopped and dropped conversation bindings. The next exec starts fresh",
				);
			if (outcome.error)
				cell.result = { status: "error", items: [], errorText: outcome.error };
			else cell.result = { status: "ok", items: [] };
		} catch (error) {
			if (execution.kernel?.failed || execution.stopping) {
				this.kernel = undefined;
				this.stored.clear();
			}
			if (!cell.result)
				cell.result = {
					status: "error",
					items: [],
					errorText: error instanceof Error ? error.message : String(error),
				};
		} finally {
			this.delegate.cancelCell(cell.id);
			if (execution.kernel?.failed || execution.stopping)
				this.kernel = undefined;
			cell.markCompleted();
		}
	}

	private bindContext(context: ToolExecutionContext): void {
		if (!context.extensionContext)
			throw new Error("VM Code requires an extension session context");
		const identity = JSON.stringify([
			context.cwd,
			notebookSessionIdentity(context.extensionContext),
		]);
		if (this.identity === identity) return;
		if (this.active && !this.active.cell.isCompleted())
			throw new Error(
				"VM Code session changed; terminate the running exec before starting this conversation",
			);
		this.switching = this.drop().then(() => {
			this.delegate.clear();
		});
		this.identity = identity;
	}

	private writeStore(key: string, json?: string): void {
		let size = json === undefined ? 0 : key.length + json.length;
		for (const [name, value] of this.stored)
			if (name !== key) size += name.length + value.length;
		if (json !== undefined && json.length > VM_STORE_VALUE_MAX)
			throw new Error("Stored value is too large; store less data");
		if (size > VM_STORE_TOTAL_MAX)
			throw new Error("Store is full; delete keys with store(key, undefined)");
		if (json === undefined) this.stored.delete(key);
		else this.stored.set(key, json);
	}

	private async drop(): Promise<void> {
		const kernel = this.kernel;
		this.kernel = undefined;
		this.stored.clear();
		this.lastMemory = undefined;
		await kernel?.stop();
	}

	private async stop(execution: Execution, reason: string): Promise<void> {
		if (execution.cell.isCompleted() && execution.stopping) return;
		execution.stopping ??= (async () => {
			execution.cell.terminated = true;
			execution.cell.controller.abort();
			this.delegate.cancelCell(execution.cell.id);
			await execution.kernel?.stop();
			await execution.done;
			execution.cell.result = { status: "error", items: [], errorText: reason };
			await this.drop();
		})();
		await execution.stopping;
	}

	private async observe(
		execution: Execution,
		ms: number,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		const kind = await execution.cell.observe(ms, signal);
		if (
			kind === "yielded" &&
			!execution.cooperative &&
			execution.inflight === 0
		) {
			await this.stop(execution, STALL);
			return this.response(execution, "result");
		}
		if (kind === "yielded") execution.cooperative = false;
		return this.response(execution, kind);
	}

	private response(
		execution: Execution,
		kind: RuntimeResponse["kind"],
	): RuntimeResponse {
		const cell = execution.cell;
		const attached = this.delegate.attach({
			kind,
			cellId: cell.id,
			contentItems: cell.takeContent(),
			maxOutputTokens: cell.maxOutputTokens,
			...(kind !== "yielded" && cell.result?.errorText
				? { errorText: cell.result.errorText }
				: {}),
		});
		if (kind !== "yielded") {
			if (this.active === execution) this.active = undefined;
			this.delegate.closeCell(cell.id);
		}
		return attached;
	}
}

function toolDefinitions(tools: CodeModeToolDefinition[]): VmTool[] {
	return tools.map((tool) => ({
		name: tool.name,
		exposed: codeModeGlobalName(tool.name),
		...(isCodeModeToolDiscoverable(tool)
			? { description: formatCodeModeToolHelp(tool) }
			: {}),
		...("textOutput" in tool && tool.textOutput
			? { output: tool.textOutput }
			: {}),
	}));
}
