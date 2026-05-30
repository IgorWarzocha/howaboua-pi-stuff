import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createChildRunDetails,
	isSubagentFailure,
	resolveReviewConfig,
} from "./config.js";
import { REVIEW_COMMAND } from "./constants.js";
import { buildReviewConversationSummary } from "./conversation-summary.js";
import { buildReviewUserMessage, sendReviewPrefaceOnce } from "./messages.js";
import { buildReviewTask, detectReviewContext } from "./review.js";
import {
	applyReviewLoopMarker,
	getSemanticLeafId,
	parseReviewArgs,
	readReviewLoopState,
	summarizeReviewLoopIncrement,
} from "./review-loop.js";
import { getFinalOutput, runReviewSubagent } from "./subagent.js";

export function registerReviewCommand(pi: ExtensionAPI) {
	pi.registerCommand(REVIEW_COMMAND, {
		description:
			"Run an isolated code-review subagent against the current repo and send the findings back as a user message",
		handler: async (args, ctx) => {
			const parsedArgs = parseReviewArgs(args);
			const reviewPrefaceDetails: { markerId?: string } = {};
			const setReviewWidget = (message?: string) => {
				ctx.ui.setWidget(
					REVIEW_COMMAND,
					message
						? [
								ctx.ui.theme.fg("accent", "╭─ Review"),
								`${ctx.ui.theme.fg("muted", "│")} ${message}`,
								ctx.ui.theme.fg("muted", "╰─ Please wait"),
							]
						: undefined,
					{ placement: "aboveEditor" },
				);
			};

			if (!ctx.isIdle()) {
				ctx.ui.notify(
					`Waiting for the current turn to finish before running /${REVIEW_COMMAND}...`,
					"info",
				);
				await ctx.waitForIdle();
			}

			if (!parsedArgs.startLoop) {
				const markerId = readReviewLoopState(ctx)?.markerId;
				if (markerId) {
					const loopResult = await summarizeReviewLoopIncrement(
						pi,
						ctx,
						markerId,
					);
					if (loopResult === "cancelled") {
						ctx.ui.notify("/review cancelled", "warning");
						return;
					}
				}
			}

			let review;
			try {
				review = await detectReviewContext(pi, ctx.cwd);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
				return;
			}

			if (parsedArgs.startLoop) {
				const targetId = getSemanticLeafId(ctx);
				if (targetId) {
					reviewPrefaceDetails.markerId = targetId;
					applyReviewLoopMarker(
						pi,
						ctx,
						targetId,
						readReviewLoopState(ctx)?.markerId,
					);
					ctx.ui.notify("Review loop marker set", "info");
				}
			}
			sendReviewPrefaceOnce(pi, ctx, reviewPrefaceDetails);

			if (!review.hasAnyChanges) {
				pi.sendUserMessage(
					buildReviewUserMessage(
						review,
						"No changes found relative to the selected base branch.",
					),
				);
				ctx.ui.notify(
					`No changes found relative to ${review.baseBranch}; sent summary to the agent.`,
					"info",
				);
				return;
			}

			const reviewConfig = await resolveReviewConfig(pi, ctx);
			let conversationSummary: string | undefined;
			let details = createChildRunDetails("", review.repoRoot, reviewConfig);
			try {
				try {
					if (reviewConfig.summary.enabled) {
						if (reviewConfig.summary.source === "current")
							ctx.ui.notify(
								`Configured summary model unavailable; falling back to current session model ${reviewConfig.summary.model}.`,
								"warning",
							);
						setReviewWidget("Preparing review context…");
						conversationSummary = await buildReviewConversationSummary(
							ctx,
							reviewConfig,
						);
					}
				} catch (error) {
					if (ctx.signal?.aborted) return;
					ctx.ui.notify(
						`Conversation summary unavailable: ${error instanceof Error ? error.message : String(error)}; continuing with diff-only review.`,
						"warning",
					);
				}

				const task = buildReviewTask(
					review,
					parsedArgs.focus,
					conversationSummary,
				);
				details = createChildRunDetails(task, review.repoRoot, reviewConfig);
				if (reviewConfig.source === "current") {
					ctx.ui.notify(
						`Configured review model unavailable; falling back to current session model ${reviewConfig.model}.`,
						"warning",
					);
				}

				setReviewWidget("Reviewing changes…");
				details = await runReviewSubagent(
					task,
					review.repoRoot,
					reviewConfig,
					ctx.signal,
				);
				if (ctx.signal?.aborted) return;
				const finalOutput =
					getFinalOutput(details.messages).trim() ||
					"No actionable issues found.";
				if (isSubagentFailure(details))
					throw new Error(
						details.errorMessage || details.stderr || finalOutput,
					);

				const message = buildReviewUserMessage(review, finalOutput);
				if (ctx.isIdle()) pi.sendUserMessage(message);
				else pi.sendUserMessage(message, { deliverAs: "followUp" });
				ctx.ui.notify(
					`Review findings sent back to the main agent from /${REVIEW_COMMAND}.`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				details.exitCode = details.exitCode || 1;
				details.errorMessage = message;
				ctx.ui.notify(`/${REVIEW_COMMAND} failed: ${message}`, "error");
			} finally {
				setReviewWidget();
			}
		},
	});
}
