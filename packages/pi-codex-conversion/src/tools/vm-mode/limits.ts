/** Notebook's default is 4096 MiB. This mode is one conversation, so the cap stays far below that. */
export const VM_HEAP_CAP_MIB = 256;
export const VM_HEAP_MIN_MIB = 64;
export const VM_STORE_VALUE_MAX = 256 * 1024;
export const VM_STORE_TOTAL_MAX = 1024 * 1024;

export function vmHeapMiB(requested: number): number {
	if (!Number.isSafeInteger(requested) || requested < VM_HEAP_MIN_MIB)
		throw new Error(
			`VM Code requires a heap budget of at least ${VM_HEAP_MIN_MIB} MiB`,
		);
	return Math.min(requested, VM_HEAP_CAP_MIB);
}
