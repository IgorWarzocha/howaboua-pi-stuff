import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { REVIEW_COMMAND } from "./constants.js";
import type { ReviewContext } from "./types.js";

export const REVIEW_LOOP_PREFACE_MESSAGE_TYPE = "subagent-review-preface";
export const REVIEW_FINDINGS_MESSAGE_TYPE = "subagent-review-findings";

export const REVIEW_LOOP_PREFACE_MESSAGE = [
	"A review subagent is about to inspect the repository in isolation. Its findings are advisory only and may be wrong, overbroad, or missing session context.",
	"",
	"Do not treat review findings as a TODO list. Do not implement review findings automatically.",
	"",
	"When findings return, compare each one against the user’s actual request, prior conversation, accepted decisions, intentional tradeoffs from this session, and the current implementation.",
	"",
	"Default response: summarize and triage, not code.",
	"",
	"For each finding, mark one of:",
	"",
	"- address: concrete, in-scope, necessary for the current implementation",
	"- defer: plausible but outside the current work",
	"- skip: stylistic, speculative, preference-based, overengineered, or not useful",
	"",
	"Only after triage, explain what you recommend doing next. If a finding is not obviously required for the current implementation, do not change code for it.",
].join("\n");

function getReviewPrefaceMessageId(
	ctx: ExtensionCommandContext,
): string | undefined {
	let messageId: string | undefined;
	for (const entry of ctx.sessionManager.buildContextEntries()) {
		if (
			entry.type === "custom_message" &&
			entry.customType === REVIEW_LOOP_PREFACE_MESSAGE_TYPE
		) {
			messageId = entry.id;
		}
	}
	return messageId;
}

export function sendReviewPrefaceOnce(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	details: { markerId?: string } = {},
): { inserted: boolean; entryId?: string } {
	const existingId = getReviewPrefaceMessageId(ctx);
	if (existingId) return { inserted: false, entryId: existingId };

	const previousLeafId = ctx.sessionManager.getLeafId();
	pi.sendMessage(
		{
			customType: REVIEW_LOOP_PREFACE_MESSAGE_TYPE,
			content: REVIEW_LOOP_PREFACE_MESSAGE,
			display: true,
			details,
		},
		{ triggerTurn: false },
	);

	const nextLeafId = ctx.sessionManager.getLeafId();
	if (nextLeafId && nextLeafId !== previousLeafId) {
		return { inserted: true, entryId: nextLeafId };
	}
	return { inserted: true };
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
		"Do not treat review findings as a TODO list. Default response: summarize and triage, not code.",
		"",
		"Compare each finding against the user’s actual request, prior conversation, accepted decisions, intentional tradeoffs from this session, and the current implementation.",
		"",
		"Mark each finding as address, defer, or skip. Only change code for findings that are obviously required for the current implementation.",
	].join("\n");
}

export function sendReviewFindings(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	review: ReviewContext,
	findings: string,
): void {
	pi.sendMessage(
		{
			customType: REVIEW_FINDINGS_MESSAGE_TYPE,
			content: buildReviewUserMessage(review, findings),
			display: true,
			details: { repoRoot: review.repoRoot, scope: review.scope },
		},
		ctx.isIdle() ? { triggerTurn: true } : { deliverAs: "followUp" },
	);
}
