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
	"Default response: verify and triage, not code.",
	"",
	"For each verified finding, recommend one of:",
	"",
	"- address: concrete, in-scope, necessary for the current implementation",
	"- defer: plausible but outside the current work",
	"- skip: stylistic, speculative, preference-based, overengineered, or not useful",
	"",
	"After triage, obtain the user’s disposition. If a finding is not obviously required for the current implementation, recommend deferring or skipping it.",
].join("\n");

const REVIEW_SUMMARY_STARTED_PROMPT =
	"The current conversation is being summarised to prepare context for an isolated code review. Please announce this briefly in your natural voice.";
const REVIEW_FINDINGS_READY_PROMPT =
	"The isolated code review has finished, and its findings have been sent to the main agent for triage. Announce this briefly in your natural voice. When the main agent responds, continue with its substantive triage without repeating this status.";
const REVIEW_FINDINGS_FOLLOW_UP = [
	"Treat the findings above as advisory and unverified. Read the cited files and trace the relevant paths before deciding whether each finding is true, necessary, and in scope. Compare them against the user’s request, prior decisions, and current implementation. Do not merely summarize the reviewer output.",
	"",
	"Before changing code, get the user’s disposition on the verified findings using an available ask/questions tool, or a normal message if none is available. After dispositions are agreed, do not summarize them again: start the agreed work. If any remain ambiguous, complete the clear, simple, non-blocking agreed fixes first, then return to the ambiguous findings.",
].join("\n");

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

function buildReviewFindingsMessage(
	review: ReviewContext,
	findings: string,
): string {
	return [
		`Review findings from /${REVIEW_COMMAND} ${buildReviewScopeText(review)}:`,
		"",
		findings.trim() || "No actionable issues found.",
	].join("\n");
}

export function sendReviewFindings(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	review: ReviewContext,
	findings: string,
): void {
	const normalizedFindings = findings.trim();
	const idle = ctx.isIdle();
	pi.sendMessage(
		{
			customType: REVIEW_FINDINGS_MESSAGE_TYPE,
			content: buildReviewFindingsMessage(review, findings),
			display: true,
			details: { repoRoot: review.repoRoot, scope: review.scope },
		},
		idle ? { triggerTurn: false } : { deliverAs: "followUp" },
	);
	if (
		!normalizedFindings ||
		normalizedFindings === "No actionable issues found."
	)
		return;
	pi.sendUserMessage(
		REVIEW_FINDINGS_FOLLOW_UP,
		idle ? undefined : { deliverAs: "followUp" },
	);
}
