import { writeNotebookCheckpoint, type NotebookCheckpointIdentity } from "./checkpoint.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";

const CHECKPOINT_DEBOUNCE_MS = 1_500;

export class NotebookCheckpointManager {
	private readonly maxBytes: number;
	private readonly currentKernel: () => DenoJupyterKernel | undefined;
	private readonly runningCellId: () => string | undefined;
	private readonly reportNotice: (notice: string, showInUi: boolean) => void;
	private baselineNames = new Set<string>();
	private identity: NotebookCheckpointIdentity | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private dirty = false;
	private maintenance: Promise<void> = Promise.resolve();

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

	configure(identity: NotebookCheckpointIdentity, baselineNames: Set<string>): void {
		this.identity = identity;
		this.baselineNames = baselineNames;
	}

	schedule(): void {
		this.dirty = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.flush();
		}, CHECKPOINT_DEBOUNCE_MS);
		this.timer.unref?.();
	}

	flush(requireIdle = false): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		const operation = this.maintenance.then(() => this.perform(requireIdle));
		this.maintenance = operation.catch(() => undefined);
		return operation;
	}

	reset(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.baselineNames.clear();
		this.identity = undefined;
		this.dirty = false;
		this.maintenance = Promise.resolve();
	}

	private async perform(requireIdle: boolean): Promise<void> {
		const runningCellId = this.runningCellId();
		if (runningCellId) {
			if (!requireIdle) return;
			const notice = `Notebook checkpoint skipped because cell "${runningCellId}" is still running; the last completed checkpoint remains available`;
			this.reportNotice(notice, false);
			throw new Error(notice);
		}
		const kernel = this.currentKernel();
		if (!this.dirty || !kernel || !this.identity) return;
		this.dirty = false;
		try {
			await writeNotebookCheckpoint(kernel, this.identity, this.baselineNames, this.maxBytes);
		} catch (error) {
			this.dirty = true;
			this.reportNotice(`Session notebook checkpoint failed: ${error instanceof Error ? error.message : String(error)}`, true);
		}
	}
}
