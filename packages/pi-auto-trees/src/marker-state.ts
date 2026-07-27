import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const INCREMENTAL_WORKFLOW_STATE_ENTRY = "incremental-workflow-state";
export const INCREMENTAL_WORKFLOW_MARKER_LABEL = "marker";

interface IncrementalWorkflowState {
	version: 1;
	markerId: string;
}

function isIncrementalWorkflowState(
	value: unknown,
): value is IncrementalWorkflowState {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { version?: unknown; markerId?: unknown };
	return candidate.version === 1 && typeof candidate.markerId === "string";
}

function readStateFromBranch(
	ctx: ExtensionContext,
): IncrementalWorkflowState | undefined {
	let state: IncrementalWorkflowState | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (
			entry.type === "custom" &&
			entry.customType === INCREMENTAL_WORKFLOW_STATE_ENTRY &&
			isIncrementalWorkflowState(entry.data)
		) {
			state = entry.data;
		}
	}
	return state;
}

export function getSemanticLeafId(ctx: ExtensionContext): string | undefined {
	let currentId = ctx.sessionManager.getLeafId();
	while (currentId) {
		const entry = ctx.sessionManager.getEntry(currentId);
		if (!entry) return undefined;
		if (entry.type === "custom" || entry.type === "label") {
			currentId = entry.parentId;
			continue;
		}
		return currentId;
	}
	return undefined;
}

export class WorkflowMarker {
	#markerId: string | undefined;

	get id(): string | undefined {
		return this.#markerId;
	}

	refresh(ctx: ExtensionContext): void {
		this.#markerId = readStateFromBranch(ctx)?.markerId;
	}

	apply(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		nextMarkerId: string,
		notifyMessage: string,
	): void {
		if (
			this.#markerId &&
			this.#markerId !== nextMarkerId &&
			ctx.sessionManager.getLabel(this.#markerId) ===
				INCREMENTAL_WORKFLOW_MARKER_LABEL
		) {
			pi.setLabel(this.#markerId, undefined);
		}

		let labelNote = "";
		const existingLabel = ctx.sessionManager.getLabel(nextMarkerId);
		if (
			existingLabel === undefined ||
			existingLabel === INCREMENTAL_WORKFLOW_MARKER_LABEL
		) {
			pi.setLabel(nextMarkerId, INCREMENTAL_WORKFLOW_MARKER_LABEL);
		} else {
			labelNote = ` Existing label "${existingLabel}" kept.`;
		}

		pi.appendEntry(INCREMENTAL_WORKFLOW_STATE_ENTRY, {
			version: 1,
			markerId: nextMarkerId,
		} satisfies IncrementalWorkflowState);
		this.#markerId = nextMarkerId;
		ctx.ui.notify(`${notifyMessage}${labelNote}`, "info");
	}
}
