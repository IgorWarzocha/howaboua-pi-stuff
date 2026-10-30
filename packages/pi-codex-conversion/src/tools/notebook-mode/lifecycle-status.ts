import type { NotebookControlResult } from "../code-mode/types.ts";
import type { NotebookLifecycleHost } from "./lifecycle.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";
import { globMatcher } from "./glob.ts";
import { formatStatus, remainingDetailsBudget, takeDetailValues, withinNameBudget, type NotebookStatusDetails } from "./lifecycle-result.ts";
import { notebookStatusSource, parseNotebookRuntimeResult, type NotebookKernelStatus } from "./lifecycle-runtime.ts";
import { randomUUID } from "node:crypto";

const STATUS_TIMEOUT_MS = 8_000;
type NotebookStatusHost = Pick<NotebookLifecycleHost, "kernel" | "activeCellId" | "retainedBindings" | "metadata">;

export async function readNotebookStatus(host: NotebookStatusHost, userBindingNames: (kernel: DenoJupyterKernel, signal?: AbortSignal) => Promise<string[]>, query: string | undefined, signal?: AbortSignal): Promise<NotebookControlResult> {
	const kernel = host.kernel()!;
	const activeCell = host.activeCellId();
	const statusSignal = signal
		? AbortSignal.any([signal, AbortSignal.timeout(STATUS_TIMEOUT_MS)])
		: AbortSignal.timeout(STATUS_TIMEOUT_MS);
	const allNames = activeCell ? [] : await userBindingNames(kernel, statusSignal);
	const matches = query === undefined ? [] : allNames.filter(globMatcher(query));
	const selected = withinNameBudget(matches);
	const retained = host.retainedBindings();
	const retainedByName = new Map(retained.map((binding) => [binding.name, binding]));
	let runtime: NotebookKernelStatus | undefined;
	if (!activeCell) {
		const marker = `__PI_NOTEBOOK_LIFECYCLE_${randomUUID()}__`;
		runtime = parseNotebookRuntimeResult<NotebookKernelStatus>(
			await kernel.execute(notebookStatusSource(selected, marker), { signal: statusSignal }),
			marker,
		);
	}
	const metadata = host.metadata();
	const inspectedMatches = (runtime?.bindings ?? []).map((binding) => {
		const retainedBinding = retainedByName.get(binding.name);
		return {
			...binding,
			...(retainedBinding ? {
				bytes: retainedBinding.bytes,
				updatedAt: retainedBinding.updatedAt,
				pinned: retainedBinding.pinned,
				hook: retainedBinding.hook,
				...(retainedBinding.description === undefined ? {} : { description: retainedBinding.description }),
				...(retainedBinding.usage === undefined ? {} : { usage: retainedBinding.usage }),
			} : {}),
		};
	});
	const pinned = retained.filter((binding) => binding.pinned);
	const unpinned = retained
		.filter(({ pinned }) => !pinned)
		.sort((left, right) => right.bytes - left.bytes);
	const largestUnpinned = unpinned.slice(0, 8);
	const baseDetails: NotebookStatusDetails = {
		state: activeCell ? "running" : "idle",
		...(activeCell ? { activeCell } : {}),
		userBindings: activeCell ? undefined : allNames.length,
		userCells: metadata.userCells,
		...(metadata.startedAt ? { startedAt: new Date(metadata.startedAt).toISOString() } : {}),
		memory: runtime?.memory ?? metadata.memory,
		checkpoint: metadata.checkpoint,
		retainedBindings: retained.length,
		retainedBytes: retained.reduce((total, binding) => total + binding.bytes, 0),
		pinnedBindings: pinned.length,
		pinned: [],
		omittedPinned: pinned.length,
		largestUnpinned: [],
		omittedLargestUnpinned: unpinned.length,
		...(query === undefined ? {} : {
			query,
			matches: [],
			omittedMatches: matches.length,
		}),
	};
	const detailBudget = remainingDetailsBudget(baseDetails);
	const reportedMatches = takeDetailValues(inspectedMatches, detailBudget);
	const reportedPinned = takeDetailValues(pinned, detailBudget);
	const reportedLargestUnpinned = takeDetailValues(largestUnpinned, detailBudget);
	const details: NotebookStatusDetails = {
		...baseDetails,
		pinned: reportedPinned,
		omittedPinned: pinned.length - reportedPinned.length,
		largestUnpinned: reportedLargestUnpinned,
		omittedLargestUnpinned: unpinned.length - reportedLargestUnpinned.length,
		...(query === undefined ? {} : {
			matches: reportedMatches,
			omittedMatches: Math.max(0, matches.length - reportedMatches.length),
		}),
	};
	return { message: formatStatus(details), details };
}
