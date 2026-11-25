import { randomUUID } from "node:crypto";
import { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import {
	formatCodeModeToolHelp,
	isCodeModeToolListed,
} from "../code-mode/execution-prompt.ts";
import {
	DEFAULT_EXEC_YIELD_MS,
	parseExecSource,
} from "../code-mode/exec-contract.ts";
import type {
	CodeModeClientOptions,
	CodeModeExecutionClient,
} from "../execution/runtime.ts";
import { directToolYieldTime } from "../code-mode/tool-source.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import { RuntimeCell } from "../code-mode/runtime-cell.ts";
import { executionSessionIdentity } from "../code-mode/session-identity.ts";
import type { VmBindingInventory } from "./binding-inventory.ts";
import { VmKernel } from "./kernel.ts";
import { vmHeapMiB } from "./limits.ts";
import { VmMemoryPressure } from "./memory-pressure.ts";
import type { VmTool } from "./protocol.ts";
import { VmStore } from "./store.ts";

interface Execution {
	cell: RuntimeCell;
	kernel?: VmKernel;
	done: Promise<void>;
	stopping?: Promise<void>;
	inflight: number;
}

const STALL =
	"VM Code stopped a stalled script. Conversation bindings dropped. Next exec starts fresh.";
const RESET = "VM Code reset and dropped conversation bindings";

/** One context for the active conversation. Session changes, terminate, stall and memory limits drop it. */
export class VmCodeClient implements CodeModeExecutionClient {
	private readonly delegate: CodeModeDelegateRuntime;
	private readonly heapMiB: number;
	private readonly pressure: VmMemoryPressure;
	private kernel: VmKernel | undefined;
	private active: Execution | undefined;
	private identity: string | undefined;
	private readonly store = new VmStore();
	private closing: Promise<void> | undefined;
	private switching: Promise<void> = Promise.resolve();

	constructor(
		options: CodeModeClientOptions,
		renderStore?: CodeModeNestedRenderStore,
	) {
		if (
			process.versions["bun"] &&
			!["linux", "darwin", "win32"].includes(process.platform)
		)
			throw new Error(
				"VM Code under Bun is available on Linux, macOS and Windows. Start Pi under Node.js or select Code in /codex settings",
			);
		this.heapMiB = vmHeapMiB(options.maxHeapMiB);
		this.pressure = new VmMemoryPressure(this.heapMiB);
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
		return this.withConversation(context, signal, () =>
			this.executeBound(source, context, signal, tools),
		);
	}

	private async executeBound(
		source: string,
		context: ToolExecutionContext,
		signal: AbortSignal | undefined,
		tools: CodeModeToolDefinition[],
	): Promise<RuntimeResponse> {
		if (this.active?.cell.isCompleted()) {
			this.delegate.closeCell(this.active.cell.id);
			this.active = undefined;
		}
		if (this.active)
			throw new Error(
				"VM Code is still running an exec; wait for it or terminate it",
			);
		if (/^\/\/\s*@exec:\s*\{\s*"reset"\s*:\s*true\s*\}$/.test(source.trim()))
			return this.restart();
		const parsed = parseExecSource(source);
		const cell = new RuntimeCell({
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
					DEFAULT_EXEC_YIELD_MS,
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
		return this.withConversation(context, undefined, () =>
			this.waitBound(id, yieldTimeMs, context, signal),
		);
	}

	private async waitBound(
		id: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
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
		return this.withConversation(context, signal, async () => {
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
		});
	}

	clearOpaqueResults(): void {
		this.delegate.clearOpaqueResults();
	}

	sampleHeapUsedBytes(): Promise<number> | undefined {
		if (!this.kernel || this.kernel.failed) return undefined;
		return this.kernel.sampleHeapUsedBytes();
	}

	async bindingInventory(
		context: ToolExecutionContext,
	): Promise<VmBindingInventory> {
		const signal = context.extensionContext?.signal;
		return this.withConversation(context, signal, async () => {
			const kernel = this.kernel;
			if (!kernel || kernel.failed)
				return { kind: "bindings", names: [], warn: false };
			const { names, memoryUsedBytes } = await kernel.bindings();
			signal?.throwIfAborted();
			if (
				kernel === this.kernel &&
				!this.active &&
				!this.closing &&
				this.pressure.shouldRestart(memoryUsedBytes)
			)
				return {
					kind: "reset",
					storedKeysSummary: await this.restartKernel(),
				};
			return {
				kind: "bindings",
				names,
				warn: kernel === this.kernel && this.pressure.observe(memoryUsedBytes),
			};
		});
	}

	async shutdown(): Promise<void> {
		if (!this.closing)
			this.closing = this.switching
				.then(async () => {
					if (this.active && !this.active.cell.isCompleted())
						await this.stop(this.active, RESET);
					await this.drop();
				})
				.finally(() => {
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
				{ source: cell.source, tools, store: this.store.snapshot() },
				{
					output: (items) => cell.emit(items),
					notify: (text) => this.delegate.notifyDirect(cell.id, text),
					store: (key, json) => this.store.set(key, json),
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
			if (execution.kernel.failed)
				throw new Error(
					outcome.error ||
						"VM Code stopped and dropped conversation bindings. The next exec starts fresh",
				);
			cell.errorText = outcome.error;
		} catch (error) {
			if (execution.kernel?.failed || execution.stopping) {
				await this.drop();
			}
			cell.errorText ??= error instanceof Error ? error.message : String(error);
		} finally {
			this.delegate.cancelCell(cell.id);
			cell.markCompleted();
		}
	}

	private async withConversation<T>(
		context: ToolExecutionContext,
		signal: AbortSignal | undefined,
		action: () => T | Promise<T>,
	): Promise<T> {
		for (;;) {
			signal?.throwIfAborted();
			if (this.closing) throw new Error("VM Code is shutting down");
			const transition = this.switching;
			await transition;
			signal?.throwIfAborted();
			if (this.closing) throw new Error("VM Code is shutting down");
			if (transition !== this.switching) continue;
			this.bindContext(context);
			// Admit synchronously after checking the live transition. A competing
			// reset can replace it while another caller awaits the old one.
			if (transition === this.switching) return action();
		}
	}

	private bindContext(context: ToolExecutionContext): void {
		if (!context.extensionContext)
			throw new Error("VM Code requires an extension session context");
		const identity = JSON.stringify([
			context.cwd,
			executionSessionIdentity(context.extensionContext),
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

	private async drop(): Promise<void> {
		this.store.clear();
		await this.stopKernel();
	}

	private async stopKernel(): Promise<void> {
		const kernel = this.kernel;
		this.kernel = undefined;
		this.pressure.reset();
		await kernel?.stop();
	}

	private async restartKernel(): Promise<string> {
		// Both restart paths keep the bounded conversation store; teardown does not.
		const storedKeysSummary = this.store.describeRetainedKeys();
		this.switching = this.stopKernel();
		await this.switching;
		return storedKeysSummary;
	}

	private async restart(): Promise<RuntimeResponse> {
		const storedKeysSummary = await this.restartKernel();
		return {
			kind: "result",
			cellId: `vm-${randomUUID()}`,
			vmReset: true,
			contentItems: [
				{
					type: "input_text",
					text: `VM reset. All bindings cleared. ${storedKeysSummary}`,
				},
			],
		};
	}

	private async stop(execution: Execution, reason: string): Promise<void> {
		if (execution.cell.isCompleted() && execution.stopping) return;
		execution.stopping ??= (async () => {
			execution.cell.terminated = true;
			execution.cell.controller.abort();
			this.delegate.cancelCell(execution.cell.id);
			await execution.kernel?.stop();
			await execution.done;
			execution.cell.errorText = reason;
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
		if (kind === "yielded" && execution.inflight === 0) {
			await this.stop(execution, STALL);
			return this.response(execution, "result");
		}
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
			...(kind !== "yielded" && cell.errorText
				? { errorText: cell.errorText }
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
		...(isCodeModeToolListed(tool)
			? { description: formatCodeModeToolHelp(tool) }
			: {}),
		...("textOutput" in tool && tool.textOutput
			? { output: tool.textOutput }
			: {}),
	}));
}
