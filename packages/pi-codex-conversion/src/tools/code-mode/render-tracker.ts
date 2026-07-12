type RenderStatus = "running" | "done" | "yielded";
const MAX_TRACKED_CODE_MODE_CALLS = 1_000;

export interface CodeModeRenderTracker {
	register(
		toolCallId: string | undefined,
		invalidate: (() => void) | undefined,
	): void;
	start(toolCallId: string): void;
	finish(toolCallId: string, status?: Exclude<RenderStatus, "running">): void;
	status(toolCallId: string | undefined): RenderStatus;
}

export function createCodeModeRenderTracker(): CodeModeRenderTracker {
	const entries = new Map<
		string,
		{ status: RenderStatus; invalidate?: (() => void) | undefined }
	>();
	return {
		register(toolCallId, invalidate) {
			if (!toolCallId) return;
			const entry = entries.get(toolCallId) ?? { status: "running" as const };
			entry.invalidate = invalidate;
			entries.set(toolCallId, entry);
		},
		start(toolCallId) {
			const entry = entries.get(toolCallId) ?? { status: "running" as const };
			const changed = entry.status !== "running";
			entry.status = "running";
			entries.set(toolCallId, entry);
			trimRenderEntries(entries);
			if (changed) entry.invalidate?.();
		},
		finish(toolCallId, status = "done") {
			const entry = entries.get(toolCallId) ?? { status: "done" as const };
			const changed = entry.status !== status;
			const invalidate = entry.invalidate;
			entry.status = status;
			entry.invalidate = undefined;
			entries.set(toolCallId, entry);
			trimRenderEntries(entries);
			if (changed) invalidate?.();
		},
		status(toolCallId) {
			return toolCallId ? (entries.get(toolCallId)?.status ?? "done") : "done";
		},
	};
}

function trimRenderEntries(
	entries: Map<
		string,
		{ status: RenderStatus; invalidate?: (() => void) | undefined }
	>,
): void {
	while (entries.size > MAX_TRACKED_CODE_MODE_CALLS) {
		const oldest = entries.keys().next().value;
		if (typeof oldest !== "string") return;
		entries.delete(oldest);
	}
}
