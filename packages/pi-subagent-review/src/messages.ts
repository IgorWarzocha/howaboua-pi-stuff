import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { REVIEW_COMMAND } from "./constants.js";
import type { ReviewContext } from "./types.js";

export const REVIEW_LOOP_PREFACE_MESSAGE_TYPE = "subagent-review-preface";

export const REVIEW_LOOP_PREFACE_MESSAGE = [
	"Review advisory note.",
	"",
	"A review subagent is about to inspect the repository in isolation. Treat its findings as advisory review input, not direct implementation instructions.",
	"",
	"When findings come back, triage before coding. Check each item against the current task, prior conversation, accepted architectural decisions, and any intentional tradeoffs from this session.",
	"",
	"Act directly only on clearly worthwhile issues: correctness bugs, security risks, data loss, broken builds, or serious regressions. For context-dependent, stylistic, architectural, low-impact, or preference-based findings, discuss the tradeoff first and say whether you would address, defer, or skip it.",
].join("\n");

function hasReviewPrefaceMessage(ctx: ExtensionCommandContext): boolean {
	return ctx.sessionManager.getBranch().some((entry) => {
		return (
			entry.type === "custom_message" &&
			entry.customType === REVIEW_LOOP_PREFACE_MESSAGE_TYPE
		);
	});
}

export function sendReviewPrefaceOnce(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	details: { markerId?: string } = {},
): void {
	if (hasReviewPrefaceMessage(ctx)) return;

	pi.sendMessage(
		{
			customType: REVIEW_LOOP_PREFACE_MESSAGE_TYPE,
			content: REVIEW_LOOP_PREFACE_MESSAGE,
			display: true,
			details,
		},
		{ triggerTurn: false },
	);
}

export function buildReviewScopeText(review: ReviewContext): string {
	if (review.scope === "latest-commit") {
		return `for latest commit \`${review.latestCommit ?? "HEAD"}\` in \`${review.repoRoot}\` because no changes were found against the selected base`;
	}

	if (review.baseBranch && review.mergeBase) {
		return `against local base branch \`${review.baseBranch}\` in \`${review.repoRoot}\` (merge base \`${review.mergeBase.slice(0, 12)}\`)`;
	}

	return `for current repository state in \`${review.repoRoot}\` with no usable base branch or merge base`;
}

export function buildReviewUserMessage(
	review: ReviewContext,
	findings: string,
): string {
	return [
		`Review findings from /${REVIEW_COMMAND} ${buildReviewScopeText(review)}:`,
		"",
		findings.trim() || "No actionable issues found.",
		"",
		"These findings are advisory output from an isolated review subagent.",
		"",
		"Triage before coding. Weigh each item against the current task, prior conversation, accepted architectural decisions, and intentional tradeoffs from this session.",
		"",
		"If you address, skip, or defer findings, briefly say why.",
	].join("\n");
}
