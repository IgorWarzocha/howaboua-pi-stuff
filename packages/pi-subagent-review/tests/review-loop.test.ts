import { expect, test } from "bun:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	REVIEW_FINDINGS_MESSAGE_TYPE,
	REVIEW_PREFACE_MESSAGE_TYPE,
} from "../src/constants.js";
import { hasReviewLoopIncrement } from "../src/review-loop.js";

test("review-loop bookkeeping cannot become an empty increment", () => {
	const sessionManager = SessionManager.inMemory(process.cwd());
	sessionManager.appendCustomMessageEntry(
		REVIEW_PREFACE_MESSAGE_TYPE,
		"Review preface",
		true,
	);
	const markerId = sessionManager.appendCustomEntry(
		"subagent-review-loop-boundary",
		{ version: 1 },
	);
	sessionManager.appendLabelChange(markerId, "review");
	sessionManager.appendCustomEntry("subagent-review-loop-state", {
		version: 1,
		markerId,
	});
	const ctx = { sessionManager } as ExtensionCommandContext;

	expect(hasReviewLoopIncrement(ctx, markerId)).toBe(false);

	sessionManager.appendCustomMessageEntry(
		REVIEW_FINDINGS_MESSAGE_TYPE,
		"Review findings",
		true,
	);
	expect(hasReviewLoopIncrement(ctx, markerId)).toBe(false);

	sessionManager.appendCustomMessageEntry(
		REVIEW_PREFACE_MESSAGE_TYPE,
		"Restored review preface",
		true,
	);
	expect(hasReviewLoopIncrement(ctx, markerId)).toBe(false);

	sessionManager.appendMessage({
		role: "user",
		content: "Address the accepted findings",
		timestamp: Date.now(),
	});
	expect(hasReviewLoopIncrement(ctx, markerId)).toBe(true);
});
