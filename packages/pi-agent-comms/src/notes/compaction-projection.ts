import type {
	ExtensionContext,
	SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import {
	buildSessionProjection,
	prepareBranchEntries,
} from "@earendil-works/pi-coding-agent";
import { projectTreeCheckpointBranch } from "./tree-checkpoint.js";
import { projectTreeHandoffBranch } from "./tree-handoff-read.js";
import type { Windows } from "./windows.js";

export function prepareCompactionProjection(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	windows: Windows,
): { cancel: true } | undefined {
	try {
		const branch = projectTreeHandoffBranch(
			windows.projectBranch(
				projectTreeCheckpointBranch(
					event.branchEntries,
					ctx.sessionManager.getEntries(),
				),
			),
		);
		if (
			branch.length === event.branchEntries.length &&
			branch.every((entry, index) => entry === event.branchEntries[index])
		)
			return;
		const physicalCut = event.branchEntries.findIndex(
			(entry) => entry.id === event.preparation.firstKeptEntryId,
		);
		if (physicalCut < 0) throw new Error("Compaction kept boundary is missing");
		const keptIds = new Set(
			event.branchEntries.slice(physicalCut).map((entry) => entry.id),
		);
		const projection = buildSessionProjection([...branch]);
		const projected = projection.entries;
		const summary = projection.messages.find(
			(message) => message.role === "compactionSummary",
		);
		const cut = projected.findIndex((entry) =>
			keptIds.has(entry.sourceEntry.id),
		);
		if (cut < 0) throw new Error("Current context kept boundary is missing");
		const summarized = projected.slice(0, cut);
		const messages = summarized
			.flatMap((entry) => entry.messages)
			.filter(
				(message) =>
					message.role !== "system" && message.role !== "compactionSummary",
			);
		if (!messages.length) {
			ctx.ui.notify(
				"Nothing to compact in the current context window. The existing context remains.",
				"warning",
			);
			return { cancel: true };
		}
		event.branchEntries = [...branch];
		// Pi retains this object for its default summarizer after every hook.
		// Keep that route's auth, provider hooks and retries, and physical kept IDs.
		delete event.preparation.previousSummary;
		Object.assign(event.preparation, {
			...(summary ? { previousSummary: summary.summary } : {}),
			messagesToSummarize: messages,
			turnPrefixMessages: [],
			isSplitTurn: false,
			fileOps: prepareBranchEntries(
				summarized.flatMap((entry) =>
					entry.messages.map((message) => ({
						...entry.sourceEntry,
						type: "message" as const,
						message,
					})),
				),
			).fileOps,
		});
	} catch (error) {
		ctx.ui.notify(
			`Compaction failed: ${error instanceof Error ? error.message : String(error)}. The existing context remains.`,
			"error",
		);
		return { cancel: true };
	}
}
