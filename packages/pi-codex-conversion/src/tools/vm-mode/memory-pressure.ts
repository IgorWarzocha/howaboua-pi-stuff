import { VM_BUN_PROCESS_OVERHEAD_MIB } from "./limits.ts";

const WARNING_RATIO = 0.75;

/** One advisory warning per worker, sampled with its binding inventory. */
export class VmMemoryPressure {
	private readonly warningBytes: number;
	private warned = false;

	constructor(heapMiB: number) {
		const budgetMiB =
			heapMiB + (process.versions["bun"] ? VM_BUN_PROCESS_OVERHEAD_MIB : 0);
		this.warningBytes = budgetMiB * 1024 ** 2 * WARNING_RATIO;
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
