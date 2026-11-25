import { VM_BUN_PROCESS_OVERHEAD_MIB } from "./limits.ts";

const WARNING_RATIO = 0.75;
const RESTART_RATIO = 0.9;

/** One advisory warning per worker, sampled with its binding inventory. */
export class VmMemoryPressure {
	private readonly warningBytes: number;
	private readonly restartBytes: number;
	private warned = false;

	constructor(heapMiB: number) {
		const budgetMiB =
			heapMiB + (process.versions["bun"] ? VM_BUN_PROCESS_OVERHEAD_MIB : 0);
		const budgetBytes = budgetMiB * 1024 ** 2;
		this.warningBytes = budgetBytes * WARNING_RATIO;
		this.restartBytes = budgetBytes * RESTART_RATIO;
	}

	shouldRestart(usedBytes: number | undefined): boolean {
		return usedBytes !== undefined && usedBytes >= this.restartBytes;
	}

	observe(usedBytes: number | undefined): boolean {
		if (this.warned || usedBytes === undefined || usedBytes < this.warningBytes)
			return false;
		this.warned = true;
		return true;
	}

	reset(): void {
		this.warned = false;
	}
}
