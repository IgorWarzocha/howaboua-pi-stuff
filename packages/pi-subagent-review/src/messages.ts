import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	REVIEW_COMMAND,
	REVIEW_FINDINGS_MESSAGE_TYPE,
	REVIEW_PREFACE_MESSAGE_TYPE,
} from "./constants.js";
import type { ReviewContext } from "./types.js";

const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";
const REVIEW_LOOP_PREFACE_MESSAGE = [
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

const REVIEW_SUMMARY_STARTED_PROMPT =
	"The current conversation is being summarised to prepare context for an isolated code review. Please announce this briefly in your natural voice.";
const REVIEW_FINDINGS_READY_PROMPT =
	"The isolated code review has finished, and its findings have been sent to the main agent for triage. Announce this briefly in your natural voice. When the main agent responds, continue with its substantive triage without repeating this status.";

function announceReviewStatus(
	pi: ExtensionAPI,
	id: string,
	prompt: string,
): void {
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: true, prompt });
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: false, prompt });
}

export function announceReviewSummaryStarted(pi: ExtensionAPI): void {
	announceReviewStatus(
		pi,
		"pi-subagent-review:summary-started",
		REVIEW_SUMMARY_STARTED_PROMPT,
	);
}

export function announceReviewFindingsReady(pi: ExtensionAPI): void {
	announceReviewStatus(
		pi,
		"pi-subagent-review:findings-ready",
		REVIEW_FINDINGS_READY_PROMPT,
	);
}

function getReviewPrefaceMessageId(
	ctx: ExtensionCommandContext,
): string | undefined {
	let messageId: string | undefined;
	for (const entry of ctx.sessionManager.buildContextEntries()) {
		if (
			entry.type === "custom_message" &&
			entry.customType === REVIEW_PREFACE_MESSAGE_TYPE
		) {
			messageId = entry.id;
		}
	}
	return messageId;
}

export function sendReviewPreface(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	options: { freshLoop?: boolean } = {},
): void {
	if (!options.freshLoop && getReviewPrefaceMessageId(ctx)) return;
	pi.sendMessage(
		{
			customType: REVIEW_PREFACE_MESSAGE_TYPE,
			content: REVIEW_LOOP_PREFACE_MESSAGE,
			display: true,
		},
		{ triggerTurn: false },
	);
}

function buildReviewScopeText(review: ReviewContext): string {
	if (review.scope === "latest-commit") {
		return `for latest commit \`${review.latestCommit ?? "HEAD"}\` in \`${review.repoRoot}\` because no changes were found against the selected base`;
	}

	if (review.baseBranch && review.mergeBase) {
		return `against local base branch \`${review.baseBranch}\` in \`${review.repoRoot}\` (merge base \`${review.mergeBase.slice(0, 12)}\`)`;
	}

	return `for current repository state in \`${review.repoRoot}\` with no usable base branch or merge base`;
}

function buildReviewUserMessage(
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
