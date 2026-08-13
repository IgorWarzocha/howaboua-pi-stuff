import type { CodeModeExecutionClient, NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import type {
	CodeModeToolDefinition,
	NotebookControlRequest,
	NotebookControlResult,
	RuntimeResponse,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import { NotebookExecutionRuntime } from "./execution-runtime.ts";
import { NotebookLifecycleController } from "./lifecycle.ts";
import { NotebookRecoveryController } from "./recovery.ts";
import { NotebookSessionRuntime } from "./session-runtime.ts";

export class NotebookCodeModeClient implements CodeModeExecutionClient {
	private readonly execution: NotebookExecutionRuntime;
	private readonly session: NotebookSessionRuntime;
	private readonly lifecycle: NotebookLifecycleController;
	private readonly recovery: NotebookRecoveryController;

	constructor(options: NotebookRuntimeOptions) {
		let session!: NotebookSessionRuntime;
		this.execution = new NotebookExecutionRuntime(
			() => session,
			(context, signal) => this.prepareSession(context, signal),
		);
		this.session = session = new NotebookSessionRuntime({
			runtime: options,
			bridge: this.execution.bridge,
			runningCellId: () => this.execution.runningCellId(),
		});
		this.recovery = new NotebookRecoveryController({
			agentDir: options.agentDir,
			maxBytes: session.checkpointMaxBytes,
			profile: options.profile,
		}, {
			stopWithoutCheckpoint: () => this.stopWithoutCheckpoint(),
			startClean: async (context, signal) => { await session.restart(context, signal, true); },
			checkpointEmpty: () => session.checkpoints.flush({ force: true, requireIdle: true }),
			configuredProfileActive: () => session.configuredProfileLoaded(),
		});
		this.lifecycle = new NotebookLifecycleController({
			prepare: (context, signal) => this.prepareSession(context, signal),
			diagnostics: (context, signal) => this.recovery.diagnostics(context, signal),
			reset: (context, signal) => this.recovery.reset(context, signal),
			kernel: () => session.kernel(),
			activeCellId: () => this.execution.activeCellId(),
			stopActive: () => this.execution.stopActive(),
			checkpoint: (excludeNames) => this.checkpoint(excludeNames),
			retainedBindings: () => session.retainedBindings(),
			setPins: (names, pinned) => session.setPins(names, pinned),
			markChanged: () => session.checkpoints.schedule(),
			restart: (context, signal) => session.restart(context, signal),
			rollback: async (context) => { await session.restart(context, undefined, true); },
			baselineNames: () => session.baselineNames(),
			profileStorage: () => ({ agentDir: options.agentDir, maxBytes: session.checkpointMaxBytes }),
			metadata: () => session.metadata(),
		});
	}

	execute(
		source: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
		tools: CodeModeToolDefinition[] = [],
	): Promise<RuntimeResponse> {
		return this.execution.execute(source, context, signal, tools);
	}

	wait(
		cellId: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		return this.execution.wait(cellId, yieldTimeMs, context, signal);
	}

	terminate(
		cellId: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		return this.execution.terminate(cellId, context, signal);
	}

	async checkpoint(excludeNames?: ReadonlySet<string>): Promise<void> {
		await this.session.checkpoints.flush({ requireIdle: true, force: true, excludeNames });
	}

	controlNotebook(
		request: NotebookControlRequest,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<NotebookControlResult> {
		return this.lifecycle.control(request, context, signal);
	}

	async shutdown(): Promise<void> {
		await this.session.abortStartup(new Error("Notebook session is shutting down"));
		await this.execution.stopActive().catch(() => undefined);
		await this.session.checkpoints.flush({ force: true }).catch(() => undefined);
		await this.lifecycle.disposeAll().catch(() => undefined);
		this.execution.clear();
		await this.session.shutdown();
	}

	private async prepareSession(context: ToolExecutionContext, signal?: AbortSignal): Promise<void> {
		const extension = context.extensionContext;
		if (!extension) throw new Error("Notebook Code Mode requires an extension session context");
		if (!this.session.identityMatches(extension)) await this.shutdown();
		await this.session.ensure(context, signal);
	}

	private async stopWithoutCheckpoint(): Promise<string | undefined> {
		const activeCell = await this.execution.stopActive();
		this.execution.clear();
		await this.session.stopWithoutCheckpoint();
		return activeCell;
	}
}
