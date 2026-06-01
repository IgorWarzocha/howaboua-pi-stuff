import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

export const REVIEW_LOOP_STATE_ENTRY = "subagent-review-loop-state";
export const REVIEW_LOOP_BOUNDARY_ENTRY = "subagent-review-loop-boundary";
export const REVIEW_LOOP_MARKER_LABEL = "review";
export const REVIEW_LOOP_WIDGET = "subagent-review-loop";
export const REVIEW_LOOP_SUMMARY_PROMPT = [
	"Treat this as a completed review-fix increment that should become durable context before the next isolated review pass.",
	"Focus on the final accepted outcome, not dead ends or step-by-step implementation noise.",
	"Capture which review findings were addressed, which were intentionally skipped or deferred, concrete files changed, key decisions, tests/checks run, and any remaining risks that matter for the next review.",
	"Mention relevant commands, commits, PR outcomes, or review feedback only when they change future work.",
	"Omit temporary debugging details, abandoned attempts, incidental churn, and repetitive review transcript noise.",
	"Write the summary so the main agent can continue from this compacted review-loop point and immediately run the next review pass.",
].join("\n");

interface ReviewLoopState {
	version: 1;
	markerId: string;
}

export interface ParsedReviewArgs {
	startLoop: boolean;
	focus: string;
}

function isReviewLoopState(value: unknown): value is ReviewLoopState {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { version?: unknown; markerId?: unknown };
	return candidate.version === 1 && typeof candidate.markerId === "string";
}

export function parseReviewArgs(args: string): ParsedReviewArgs {
	const trimmed = args.trim();
	if (!trimmed) return { startLoop: false, focus: "" };

	const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
	const firstWord = match?.[1] ?? "";
	if (firstWord.toLowerCase() !== "loop") {
		return { startLoop: false, focus: trimmed };
	}

	return { startLoop: true, focus: (match?.[2] ?? "").trim() };
}

export function readReviewLoopState(
	ctx: ExtensionCommandContext,
): ReviewLoopState | undefined {
	let state: ReviewLoopState | undefined;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== REVIEW_LOOP_STATE_ENTRY)
			continue;
		if (isReviewLoopState(entry.data)) state = entry.data;
	}

	return state;
}

export function getSemanticLeafId(
	ctx: ExtensionCommandContext,
): string | undefined {
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

export function applyReviewLoopMarker(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	nextMarkerId: string,
	previousMarkerId?: string,
): void {
	if (
		previousMarkerId &&
		previousMarkerId !== nextMarkerId &&
		ctx.sessionManager.getLabel(previousMarkerId) === REVIEW_LOOP_MARKER_LABEL
	) {
		pi.setLabel(previousMarkerId, undefined);
	}

	const existingLabel = ctx.sessionManager.getLabel(nextMarkerId);
	if (
		existingLabel === undefined ||
		existingLabel === REVIEW_LOOP_MARKER_LABEL
	) {
		pi.setLabel(nextMarkerId, REVIEW_LOOP_MARKER_LABEL);
	}

	pi.appendEntry(REVIEW_LOOP_STATE_ENTRY, {
		version: 1,
		markerId: nextMarkerId,
	} satisfies ReviewLoopState);
}

export function appendReviewLoopBoundary(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): string | undefined {
	const previousLeafId = ctx.sessionManager.getLeafId();
	pi.appendEntry(REVIEW_LOOP_BOUNDARY_ENTRY, { version: 1 });
	const nextLeafId = ctx.sessionManager.getLeafId();
	return nextLeafId && nextLeafId !== previousLeafId ? nextLeafId : undefined;
}

export async function summarizeReviewLoopIncrement(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	markerId: string,
): Promise<"summarized" | "skipped" | "cancelled"> {
	if (!ctx.sessionManager.getEntry(markerId)) return "skipped";

	const currentSemanticLeafId = getSemanticLeafId(ctx);
	if (!currentSemanticLeafId || currentSemanticLeafId === markerId) {
		return "skipped";
	}

	const clearLoopFeedback = () => {
		if (ctx.hasUI) ctx.ui.setWidget(REVIEW_LOOP_WIDGET, undefined);
		ctx.ui.setWorkingMessage();
	};

	ctx.ui.setWorkingMessage(ctx.ui.theme.fg("dim", "Summarizing review loop…"));
	if (ctx.hasUI) {
		ctx.ui.setWidget(
			REVIEW_LOOP_WIDGET,
			[ctx.ui.theme.fg("dim", "Summarizing review loop increment...")],
			{ placement: "aboveEditor" },
		);
	}

	let result: Awaited<ReturnType<typeof ctx.navigateTree>>;
	try {
		result = await ctx.navigateTree(markerId, {
			summarize: true,
			customInstructions: REVIEW_LOOP_SUMMARY_PROMPT,
			replaceInstructions: false,
		});
	} finally {
		clearLoopFeedback();
	}

	if (result.cancelled) return "cancelled";

	const nextMarkerId = getSemanticLeafId(ctx);
	if (!nextMarkerId) return "skipped";
	applyReviewLoopMarker(pi, ctx, nextMarkerId, markerId);
	return "summarized";
}
