import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import type { NotebookMemoryUsage, ToolExecutionContext } from "../code-mode/types.ts";
import type { NotebookBridgeServer } from "./bridge-server.ts";
import { resolveNotebookCheckpointMaxBytes } from "./checkpoint.ts";
import type { NotebookCheckpointIdentity } from "./checkpoint-format.ts";
import { NotebookCheckpointManager } from "./checkpoint-manager.ts";
import { materializeNotebookJournal, type NotebookJournal } from "./journal.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";
import { extractNotebookNpmImports, recordNotebookNpmImports } from "./npm-imports.ts";
import { resolveNotebookProject } from "./project-identity.ts";
import { readRetainedProjectBindings, type RetainedProjectBinding } from "./project-state-metadata.ts";
import {
	NOTEBOOK_INTERRUPTED_NOTICE,
	NOTEBOOK_BOOTSTRAP_NOTICE,
	isNotebookBootstrapFailure,
	NOTEBOOK_KERNEL_FAILURE_NOTICE,
	type NotebookRuntimeHealth,
	type NotebookRuntimeHealthState,
} from "./runtime-health.ts";
import { startNotebookSession } from "./session-startup.ts";
import { notebookSessionIdentity } from "./session-identity.ts";

const MAX_NOTICE_CHARS = 16_384;

export class NotebookSessionRuntime {
	readonly options: NotebookRuntimeOptions;
	readonly checkpointMaxBytes: number;
	readonly checkpoints: NotebookCheckpointManager;
	private readonly bridge: NotebookBridgeServer;
	private readonly runningCellId: () => string | undefined;
	private kernelValue: DenoJupyterKernel | undefined;
	private runtimeHealthValue: NotebookRuntimeHealthState = "not_started";
	private identityValue: string | undefined;
	private checkpointIdentityValue: NotebookCheckpointIdentity | undefined;
	private startup: Promise<void> | undefined;
	private startupAbort: AbortController | undefined;
	private notice: string | undefined;
	private memoryValue: NotebookMemoryUsage | undefined;
	private journalValue: NotebookJournal | undefined;
	private extensionContext: ExtensionContext | undefined;
	private baseline = new Set<string>();
	private startedAtValue: number | undefined;
	private profileLoaded = false;

	constructor(options: {
		runtime: NotebookRuntimeOptions;
		bridge: NotebookBridgeServer;
		runningCellId(): string | undefined;
	}) {
		this.options = options.runtime;
		this.bridge = options.bridge;
		this.runningCellId = options.runningCellId;
		this.checkpointMaxBytes = resolveNotebookCheckpointMaxBytes(options.runtime.maxHeapMiB);
		this.checkpoints = new NotebookCheckpointManager({
			maxBytes: this.checkpointMaxBytes,
			currentKernel: () => this.kernelValue,
			runningCellId: this.runningCellId,
			reportNotice: (notice, showInUi) => {
				this.addNotice(notice);
				if (showInUi) this.extensionContext?.ui.notify(notice, "warning");
			},
		});
	}

	identityMatches(context: ExtensionContext): boolean {
		return !this.identityValue || this.identityValue === sessionIdentity(context);
	}

	async ensure(context: ToolExecutionContext, signal?: AbortSignal): Promise<void> {
		const extension = context.extensionContext;
		if (!extension) throw new Error("Notebook Code Mode requires an extension session context");
		this.extensionContext = extension;
		if (!this.startup) {
			this.identityValue = sessionIdentity(extension);
			this.beginStartup(extension, signal);
		}
		await this.startup;
	}

	async restart(context: ExtensionContext, signal?: AbortSignal, skipProfile = false): Promise<string | undefined> {
		await this.abortStartup(new Error("Notebook kernel is restarting"));
		try { this.materializeJournal(); } catch {}
		const previous = this.kernelValue;
		this.kernelValue = undefined;
		this.runtimeHealthValue = "not_started";
		this.startup = undefined;
		await this.checkpoints.discard();
		this.memoryValue = undefined;
		this.startedAtValue = undefined;
		this.profileLoaded = false;
		this.checkpointIdentityValue = undefined;
		await previous?.shutdown().catch(() => undefined);
		const pending = this.beginStartup(context, signal, skipProfile);
		await pending;
		return this.takeNotice();
	}

	async invalidateKernel(notice = NOTEBOOK_INTERRUPTED_NOTICE): Promise<void> {
		const kernel = this.kernelValue;
		this.kernelValue = undefined;
		this.runtimeHealthValue = "invalidated";
		this.startup = undefined;
		this.memoryValue = undefined;
		this.startedAtValue = undefined;
		this.profileLoaded = false;
		this.checkpointIdentityValue = undefined;
		this.addNotice(notice);
		await kernel?.shutdown().catch(() => undefined);
	}

	async recoverFromBootstrapFailure(value: unknown): Promise<boolean> {
		if (!isNotebookBootstrapFailure(value)) return false;
		if (this.kernelValue) await this.invalidateKernel(NOTEBOOK_BOOTSTRAP_NOTICE);
		return true;
	}

	async stopWithoutCheckpoint(): Promise<void> {
		this.startupAbort?.abort(new Error("Notebook state is being reset"));
		await this.startup?.catch(() => undefined);
		const previous = this.kernelValue;
		this.kernelValue = undefined;
		this.runtimeHealthValue = "not_started";
		this.startup = undefined;
		await this.checkpoints.discard();
		this.memoryValue = undefined;
		this.startedAtValue = undefined;
		this.profileLoaded = false;
		this.checkpointIdentityValue = undefined;
		this.notice = undefined;
		await previous?.shutdown().catch(() => undefined);
	}

	async abortStartup(reason: Error): Promise<void> {
		this.startupAbort?.abort(reason);
		await this.startup?.catch(() => undefined);
	}

	async shutdown(): Promise<void> {
		await this.abortStartup(new Error("Notebook session is shutting down"));
		try { this.materializeJournal(); } catch {}
		const kernel = this.kernelValue;
		this.kernelValue = undefined;
		this.runtimeHealthValue = "not_started";
		this.startup = undefined;
		this.startupAbort = undefined;
		this.identityValue = undefined;
		this.checkpointIdentityValue = undefined;
		this.checkpoints.reset();
		this.notice = undefined;
		this.memoryValue = undefined;
		this.journalValue = undefined;
		this.extensionContext = undefined;
		this.baseline.clear();
		this.startedAtValue = undefined;
		this.profileLoaded = false;
		await kernel?.shutdown().catch(() => undefined);
		await this.bridge.shutdown();
	}

	kernel(): DenoJupyterKernel | undefined { return this.kernelValue; }
	runtimeHealth(): NotebookRuntimeHealth { return { state: this.runtimeHealthValue }; }
	runtimeHealthFor(context: ExtensionContext): NotebookRuntimeHealth {
		return this.identityMatches(context) ? this.runtimeHealth() : { state: "not_started" };
	}
	journal(): NotebookJournal | undefined { return this.journalValue; }
	materializeJournal(): void {
		if (this.journalValue) materializeNotebookJournal(this.journalValue);
	}
	baselineNames(): ReadonlySet<string> { return this.baseline; }
	configuredProfileLoaded(): boolean { return this.profileLoaded; }
	retainedBindings(): RetainedProjectBinding[] {
		return this.checkpointIdentityValue
			? readRetainedProjectBindings(this.checkpointIdentityValue, this.checkpointMaxBytes)
			: [];
	}
	recordMemory(memory: NotebookMemoryUsage | undefined): void { this.memoryValue = memory; }
	async recordNpmImports(source: string): Promise<void> {
		const identity = this.checkpointIdentityValue;
		if (!identity) return;
		const imports = extractNotebookNpmImports(source);
		if (imports.length === 0) return;
		try {
			await recordNotebookNpmImports(identity, imports);
		} catch (error) {
			this.addNotice(`Notebook npm inventory was not updated: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	memory(): NotebookMemoryUsage | undefined { return this.memoryValue; }
	addNotice(notice: string): void { this.notice = joinNotices(this.notice, notice); }
	takeNotice(): string | undefined {
		const notice = this.notice;
		this.notice = undefined;
		return notice;
	}

	metadata(): {
		startedAt?: number | undefined;
		userCells: number;
		memory?: NotebookMemoryUsage | undefined;
		checkpoint: Record<string, unknown>;
	} {
		return {
			startedAt: this.startedAtValue,
			userCells: this.journalValue?.completedCells ?? 0,
			memory: this.memoryValue,
			checkpoint: this.checkpoints.status(),
		};
	}

	private async start(context: ExtensionContext, signal?: AbortSignal, skipProfile = false): Promise<void> {
		this.identityValue = sessionIdentity(context);
		this.extensionContext = context;
		this.memoryValue = undefined;
		const started = await startNotebookSession({
			context,
			runtime: skipProfile && this.options.profile
				? { ...this.options, profile: undefined }
				: this.options,
			bridge: this.bridge,
			checkpointMaxBytes: this.checkpointMaxBytes,
			onKernelFailure: (kernel) => this.handleKernelFailure(kernel),
			...(signal ? { signal } : {}),
		});
		this.kernelValue = started.kernel;
		this.startedAtValue = Date.now();
		this.journalValue = started.journal;
		this.checkpointIdentityValue = started.checkpointIdentity;
		this.baseline = started.baselineNames;
		this.profileLoaded = started.configuredProfileLoaded;
		this.runtimeHealthValue = "ready";
		this.checkpoints.configure(started.checkpointIdentity, started.baselineNames, started.projectBaseline);
		if (started.restoreNotice) {
			this.addNotice(started.restoreNotice);
		}
	}

	private handleKernelFailure(kernel: DenoJupyterKernel): void {
		if (this.kernelValue !== kernel) return;
		this.kernelValue = undefined;
		this.runtimeHealthValue = "invalidated";
		this.startup = undefined;
		this.memoryValue = undefined;
		this.startedAtValue = undefined;
		this.profileLoaded = false;
		this.checkpointIdentityValue = undefined;
		this.addNotice(NOTEBOOK_KERNEL_FAILURE_NOTICE);
	}

	private beginStartup(context: ExtensionContext, signal?: AbortSignal, skipProfile = false): Promise<void> {
		const startupAbort = new AbortController();
		const startupSignal = signal ? AbortSignal.any([signal, startupAbort.signal]) : startupAbort.signal;
		this.startupAbort = startupAbort;
		const pending = this.start(context, startupSignal, skipProfile)
			.catch((error) => {
				if (this.startup === pending) this.startup = undefined;
				throw error;
			})
			.finally(() => {
				if (this.startupAbort === startupAbort) this.startupAbort = undefined;
			});
		this.startup = pending;
		return pending;
	}
}

function sessionIdentity(context: ExtensionContext): string {
	return `${notebookSessionIdentity(context)}\0${resolveNotebookProject(context.cwd)}`;
}

function joinNotices(...notices: Array<string | undefined>): string | undefined {
	const present = notices.filter((notice): notice is string => Boolean(notice));
	if (present.length === 0) return undefined;
	const marker = " [Notebook notices truncated]";
	let output = "";
	for (let index = 0; index < present.length; index += 1) {
		const notice = present[index]!;
		const separator = output ? ". " : "";
		const remaining = MAX_NOTICE_CHARS - output.length - separator.length;
		if (remaining <= 0 || notice.length > remaining || index < present.length - 1 && notice.length === remaining) {
			return `${output}${separator}${notice.slice(0, Math.max(0, remaining - marker.length))}${marker}`.slice(0, MAX_NOTICE_CHARS);
		}
		output += `${separator}${notice}`;
	}
	return output;
}
