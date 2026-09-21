import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { REVIEW_COMMAND } from "./constants.js";
import {
	announceReviewFindingsReady,
	buildReviewFindings,
} from "./messages.js";
import type { ReviewContext } from "./types.js";

type ReadyReview = ReturnType<typeof buildReviewFindings> & {
	sessionId: string;
	sourceLeafId: string | null;
};

function boundaryEntry(review: ReadyReview) {
	return review.triage
		? {
				...review.entry,
				content: `${review.entry.content}\n\n${review.triage}`,
			}
		: review.entry;
}

export function registerReviewDelivery(pi: ExtensionAPI) {
	let pending: ReadyReview[] = [];
	let closed = false;

	const onCurrentBranch = (
		review: ReadyReview,
		ctx: ExtensionContext,
	): boolean => {
		const current =
			review.sessionId === ctx.sessionManager.getSessionId() &&
			(review.sourceLeafId === null ||
				ctx.sessionManager
					.getBranch()
					.some((entry) => entry.id === review.sourceLeafId));
		if (!current)
			ctx.ui.notify(
				"Review findings discarded after changing conversation branches.",
				"warning",
			);
		return current;
	};
	const takePending = (ctx: ExtensionContext): ReadyReview[] => {
		const ready = pending;
		pending = [];
		return ready.filter((review) => onCurrentBranch(review, ctx));
	};
	const notifyDelivered = (
		ctx: ExtensionContext,
		waitingForInput = false,
	): void => {
		announceReviewFindingsReady(pi);
		ctx.ui.notify(
			waitingForInput
				? "Review findings saved. Send a message to triage them."
				: `Review findings sent back to the main agent from /${REVIEW_COMMAND}.`,
			"info",
		);
	};
	const deliverIdle = (
		review: ReadyReview,
		ctx: ExtensionContext,
		continueTurn: boolean,
	): void => {
		pi.sendMessage(continueTurn ? review.entry : boundaryEntry(review), {
			triggerTurn: false,
		});
		if (continueTurn && review.triage) {
			// Pi rechecks streaming after async input hooks; a competing run gets a follow-up instead.
			pi.sendUserMessage(review.triage, { deliverAs: "followUp" });
		}
		notifyDelivered(ctx, !continueTurn && Boolean(review.triage));
	};

	// Pi 0.87 has no abort signal here. Only drain ready output; never await a reviewer.
	pi.on("agent_before_settle", (event, ctx) => {
		const ready = takePending(ctx);
		if (!ready.length) return;
		const continueTurn =
			event.outcome === "completed" && ready.some((review) => review.triage);
		notifyDelivered(
			ctx,
			!continueTurn && ready.some((review) => review.triage),
		);
		return {
			entries: [...event.entries, ...ready.map(boundaryEntry)],
			...(continueTurn ? { continue: true } : {}),
		};
	});
	pi.on("agent_settled", (_event, ctx) => {
		// Results may arrive while a later pre-settlement handler is awaiting work.
		// Pi exposes no abort outcome here; do not restart a potentially stopped run.
		for (const review of takePending(ctx)) deliverIdle(review, ctx, false);
	});
	pi.on("session_shutdown", () => {
		closed = true;
		pending = [];
	});

	return (
		ctx: ExtensionContext,
		review: ReviewContext,
		findings: string,
		sourceLeafId: string | null,
	): void => {
		if (closed) return;
		const ready: ReadyReview = {
			...buildReviewFindings(review, findings),
			sessionId: ctx.sessionManager.getSessionId(),
			sourceLeafId,
		};
		if (!onCurrentBranch(ready, ctx)) return;
		if (ctx.isIdle()) deliverIdle(ready, ctx, true);
		else pending.push(ready);
	};
}
