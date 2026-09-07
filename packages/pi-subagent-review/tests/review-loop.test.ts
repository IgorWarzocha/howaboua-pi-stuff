import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	SessionBeforeTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	REVIEW_FINDINGS_MESSAGE_TYPE,
	REVIEW_PREFACE_MESSAGE_TYPE,
} from "../src/constants.js";
import { hasReviewLoopIncrement } from "../src/review-loop.js";
import { registerTreeSummaryModel } from "../src/tree-summary.js";

test("review-loop bookkeeping and context-managed navigation avoid empty summaries", async () => {
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

	let beforeTree = (..._args: unknown[]): unknown => {
		throw new Error("session_before_tree handler not registered");
	};
	const pi = {
		on(_event: string, handler: typeof beforeTree) {
			beforeTree = handler;
		},
		getActiveTools: () => ["new_context"],
	} as unknown as ExtensionAPI;
	const navigateWithSummaryModel = registerTreeSummaryModel(pi);
	const beforeTreeEvent = {
		type: "session_before_tree",
		preparation: {
			targetId: markerId,
			oldLeafId: null,
			commonAncestorId: null,
			entriesToSummarize: [],
			userWantsSummary: true,
		},
		signal: new AbortController().signal,
	} satisfies SessionBeforeTreeEvent;
	let navigationCtx: ExtensionCommandContext;
	navigationCtx = {
		navigateTree: async () => {
			await beforeTree(beforeTreeEvent, navigationCtx);
			return { cancelled: false };
		},
		modelRegistry: {
			find() {
				throw new Error("summary model override was armed");
			},
		},
	} as unknown as ExtensionCommandContext;

	expect(
		await navigateWithSummaryModel(
			navigationCtx,
			markerId,
			{ summarize: true },
			{
				enabled: true,
				model: "test/summary",
				modelParsed: { provider: "test", modelId: "summary" },
				thinking: "off",
				source: "configured",
			},
		),
	).toEqual({ cancelled: false });
});
