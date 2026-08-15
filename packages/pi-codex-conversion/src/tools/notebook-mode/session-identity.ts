import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const NOTEBOOK_TREE_EPOCH_ENTRY = "pi-codex-conversion-notebook-tree-epoch";

export function appendNotebookTreeEpoch(pi: ExtensionAPI): void {
	pi.appendEntry(NOTEBOOK_TREE_EPOCH_ENTRY, { epoch: randomUUID() });
}

export function notebookSessionIdentity(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (
			entry?.type !== "custom"
			|| entry.customType !== NOTEBOOK_TREE_EPOCH_ENTRY
			|| !entry.data
			|| typeof entry.data !== "object"
			|| !("epoch" in entry.data)
			|| typeof entry.data.epoch !== "string"
		) continue;
		return `${ctx.sessionManager.getSessionId()}\0${entry.data.epoch}`;
	}
	return `${ctx.sessionManager.getSessionId()}\0root`;
}
