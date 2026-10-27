import type { CodeModeDelegateRuntime } from "../code-mode/delegate-runtime.ts";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import type { NotebookCell } from "../notebook-mode/cell.ts";
import { TsExecutionWorker } from "./execution-worker.ts";
import { resolveTsRuntimeImport, type TsImportOptions } from "./imports.ts";
import type { BindingRecipe, PortableCapture, PortableState } from "./portable-state.ts";
import type { TsWorkerInput, TsWorkerOutcome } from "./worker-protocol.ts";

export interface TsExecution {
	cell: NotebookCell;
	start: PortableState;
	isolated: boolean;
	worker?: TsExecutionWorker | undefined;
	imports: TsImportOptions;
	usedImports: Set<string>;
	done: Promise<void>;
	stop?: Promise<void> | undefined;
}

export const MAX_TS_WORKERS = 4;

/** Owns live-kernel failure/recovery and each cell's worker cancellation. */
export class TsSessionKernel {
	private kernel: TsExecutionWorker | undefined;
	private kernelUnavailable = false;
	private restoreFailed: string[] | undefined;
	private readonly options: NotebookRuntimeOptions;
	constructor(options: NotebookRuntimeOptions) { this.options = options; }
	get hasWorker(): boolean { return this.kernel !== undefined; }
	get unavailable(): boolean { return this.kernelUnavailable; }
	get failedRestores(): string[] | undefined { return this.restoreFailed; }
	recordOutcome(outcome: TsWorkerOutcome): void {
		if (outcome.kind === "live-done" && outcome.restoreFailed) this.restoreFailed = outcome.restoreFailed;
	}
	launch(execution: TsExecution, input: TsWorkerInput, delegate: CodeModeDelegateRuntime): Promise<TsWorkerOutcome> {
		if (!execution.isolated && this.kernelUnavailable) throw new Error("The live kernel is unavailable; use notebook restart");
		// Reserve half for the persistent heap and split the other half across bounded isolated runs.
		execution.worker = execution.isolated ? new TsExecutionWorker({ cwd: execution.cell.context.cwd, heapMiB: Math.floor(this.options.maxHeapMiB / (MAX_TS_WORKERS * 2)) }) : this.kernel ??= new TsExecutionWorker({ cwd: execution.cell.context.cwd, heapMiB: Math.floor(this.options.maxHeapMiB / 2) });
		return execution.worker.execute(input, {
				output: items => execution.cell.emit(items),
				notify: text => delegate.notifyDirect(execution.cell.id, text),
				yield: () => execution.cell.requestYield(),
				request: async (operation, id, name, value) => {
					execution.cell.controller.signal.throwIfAborted();
					return operation === "tool" ? delegate.invokeDirect(execution.cell.id, id, name, value) : resolveTsRuntimeImport(name, execution.imports);
				},
			}).catch(async error => {
				if (!execution.isolated) { this.kernelUnavailable = true; delegate.cancelCell(execution.cell.id); await execution.worker?.stop(); }
				throw error;
			});
	}

	async stop(execution: TsExecution, delegate: CodeModeDelegateRuntime): Promise<void> {
		if (execution.stop) return execution.stop;
		if (execution.cell.isCompleted()) return;
		execution.stop = (async () => {
			execution.cell.terminated = true;
			execution.cell.controller.abort();
			delegate.cancelCell(execution.cell.id);
			if (!execution.isolated && execution.worker) {
				this.kernelUnavailable = true;
				execution.cell.emit([{ type: "input_text", text: "The TS live kernel was terminated; live-only values and changes after its last durable checkpoint were lost. Use notebook restart to restore that checkpoint. Tool and file effects were not rolled back." }]);
			}
			await execution.worker?.stop();
			await execution.done;
		})();
		return execution.stop;
	}
	async capture(input: TsWorkerInput, cwd: string, bindings: Record<string, BindingRecipe> | undefined, resolveImport: (name: string) => Promise<string>): Promise<PortableCapture> {
		if (this.kernelUnavailable) throw new Error("The TS live kernel stopped; use notebook restart to restore the last durable checkpoint");
		this.kernel ??= new TsExecutionWorker({ cwd, heapMiB: Math.floor(this.options.maxHeapMiB / 2) });
		const result = await this.kernel.execute({ ...input, ...(bindings ? { bindings } : {}) }, {
			output: () => {}, notify: () => {}, yield: () => {},
			request: async (operation, _id, name) => {
				if (operation === "tool") throw new Error("Tools cannot run during TS state capture; run a normal cell instead");
				return resolveImport(name);
			},
		});
		if (result.kind !== "live-done") throw new Error("The TS live kernel did not return a capture");
		if (result.restoreFailed) this.restoreFailed = result.restoreFailed;
		if (result.error) throw new Error(result.error);
		if (result.captureError) throw new Error(`${result.captureError}. Live values remain available; the durable checkpoint was not updated`);
		return result;
	}
	async restoreAdditions(input: TsWorkerInput, restore: PortableState, resolveImport: (name: string) => Promise<string>): Promise<void> {
		if (!this.kernel) return;
		const result = await this.kernel.execute({ ...input, restore }, {
			output: () => {}, notify: () => {}, yield: () => {},
			request: async (operation, _id, name) => {
				if (operation === "tool") throw new Error("Tools cannot run while loading TS state");
				return resolveImport(name);
			},
		});
		if (result.kind === "live-done" && result.restoreFailed) this.restoreFailed = result.restoreFailed;
		if (result.kind === "live-done" && result.error) throw new Error(`TS profile load partially executed: ${result.error}. Inspect the live state or restart; no rollback occurred`);
	}
	async reset(): Promise<void> {
		await this.kernel?.stop();
		this.kernel = undefined;
		this.kernelUnavailable = false;
		this.restoreFailed = undefined;
	}
}
