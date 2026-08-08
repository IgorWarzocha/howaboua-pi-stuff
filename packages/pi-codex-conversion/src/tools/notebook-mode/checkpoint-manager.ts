import { writeNotebookCheckpoint, type NotebookCheckpointIdentity } from "./checkpoint.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";
import {
	type ProjectStateBaseline,
	writeProjectState,
} from "./project-state.ts";

const CHECKPOINT_DEBOUNCE_MS = 1_500;

export class NotebookCheckpointManager {
	private readonly maxBytes: number;
	private readonly currentKernel: () => DenoJupyterKernel | undefined;
	private readonly runningCellId: () => string | undefined;
	private readonly reportNotice: (notice: string, showInUi: boolean) => void;
	private baselineNames = new Set<string>();
	private identity: NotebookCheckpointIdentity | undefined;
	private projectBaseline: ProjectStateBaseline = { generation: "root", entries: [] };
	private timer: ReturnType<typeof setTimeout> | undefined;
	private dirty = false;
	private maintenance: Promise<void> = Promise.resolve();
	private lastCheckpointAt: string | undefined;

	constructor(options: {
		maxBytes: number;
		currentKernel(): DenoJupyterKernel | undefined;
		runningCellId(): string | undefined;
		reportNotice(notice: string, showInUi: boolean): void;
	}) {
		this.maxBytes = options.maxBytes;
		this.currentKernel = options.currentKernel;
		this.runningCellId = options.runningCellId;
		this.reportNotice = options.reportNotice;
	}

	configure(
		identity: NotebookCheckpointIdentity,
		baselineNames: Set<string>,
		projectBaseline: ProjectStateBaseline,
	): void {
		this.identity = identity;
		this.baselineNames = baselineNames;
		this.projectBaseline = projectBaseline;
	}

	schedule(): void {
		this.dirty = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.flush().catch(() => undefined);
		}, CHECKPOINT_DEBOUNCE_MS);
		this.timer.unref?.();
	}

	flush(options: {
		requireIdle?: boolean | undefined;
		force?: boolean | undefined;
		excludeNames?: ReadonlySet<string> | undefined;
	} = {}): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		const operation = this.maintenance.then(() => this.perform(options));
		this.maintenance = operation.catch(() => undefined);
		return operation;
	}

	reset(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.baselineNames.clear();
		this.identity = undefined;
		this.projectBaseline = { generation: "root", entries: [] };
		this.dirty = false;
		this.maintenance = Promise.resolve();
		this.lastCheckpointAt = undefined;
	}

	status(): {
		dirty: boolean;
		projectGeneration: string;
		projectBindings: number;
		lastCheckpointAt?: string | undefined;
	} {
		return {
			dirty: this.dirty,
			projectGeneration: this.projectBaseline.generation,
			projectBindings: this.projectBaseline.entries.length,
			...(this.lastCheckpointAt ? { lastCheckpointAt: this.lastCheckpointAt } : {}),
		};
	}

	private async perform(options: {
		requireIdle?: boolean | undefined;
		force?: boolean | undefined;
		excludeNames?: ReadonlySet<string> | undefined;
	}): Promise<void> {
		const runningCellId = this.runningCellId();
		if (runningCellId) {
			if (!options.requireIdle) return;
			const notice = `Notebook checkpoint skipped because cell "${runningCellId}" is still running; the last completed checkpoint remains available`;
			this.reportNotice(notice, false);
			throw new Error(notice);
		}
		const kernel = this.currentKernel();
		if ((!options.force && !this.dirty) || !kernel || !this.identity) return;
		this.dirty = false;
		let projectFailure: Error | undefined;
		try {
			const project = await writeProjectState(
				kernel,
				this.identity,
				this.projectBaseline,
				this.baselineNames,
				this.maxBytes,
				options.excludeNames,
			);
			this.projectBaseline = project.baseline;
			if (project.conflicts.length > 0) {
				this.reportNotice(`Project notebook conflicts preserved without overwrite: ${project.conflicts.join(", ")}`, false);
			}
		} catch (error) {
			this.dirty = true;
			const notice = `Project notebook checkpoint failed: ${error instanceof Error ? error.message : String(error)}`;
			this.reportNotice(notice, true);
			projectFailure = new Error(notice, { cause: error });
		}
		try {
			await writeNotebookCheckpoint(
				kernel,
				this.identity,
				this.baselineNames,
				this.maxBytes,
				this.projectBaseline,
				options.excludeNames,
			);
		} catch (error) {
			this.dirty = true;
			const notice = `Session notebook checkpoint failed: ${error instanceof Error ? error.message : String(error)}`;
			this.reportNotice(notice, true);
			throw new Error(notice, { cause: error });
		}
		if (projectFailure) throw projectFailure;
		this.lastCheckpointAt = new Date().toISOString();
	}
}
