import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readSummaryConfig } from "./config.js";
import { getSemanticLeafId, WorkflowMarker } from "./marker-state.js";
import {
	buildEndNavigationOptions,
	buildPrimePrompt,
	INCREMENTAL_WORKFLOW_DEFAULT_PRIME_SCOPE,
} from "./prompts.js";
import type { NavigateWithSummaryModel } from "./tree-summary.js";

export const INCREMENTAL_WORKFLOW_END_WIDGET = "auto-trees-end";

export function registerIncrementalWorkflow(
	pi: ExtensionAPI,
	navigateWithSummaryModel: NavigateWithSummaryModel,
): void {
	const marker = new WorkflowMarker();
	let pendingPrimeCount = 0;

	pi.on("session_start", async (_event, ctx) => marker.refresh(ctx));
	pi.on("session_tree", async (_event, ctx) => marker.refresh(ctx));
	pi.on("agent_settled", async (_event, ctx) => {
		if (pendingPrimeCount === 0) return;
		pendingPrimeCount -= 1;

		const targetId = getSemanticLeafId(ctx);
		if (!targetId) {
			ctx.ui.notify(
				"Priming completed but no conversation point was found to mark",
				"warning",
			);
			return;
		}
		if (marker.id === targetId) {
			ctx.ui.notify("Priming completed; marker already points here", "info");
			return;
		}

		try {
			marker.apply(pi, ctx, targetId, "Priming completed and marker set");
		} catch (error) {
			ctx.ui.notify(
				`Could not set marker after priming: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	});

	pi.registerCommand("marker", {
		description:
			"Mark the current conversation point as the incremental workflow checkpoint",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			const targetId = getSemanticLeafId(ctx);
			if (!targetId) {
				ctx.ui.notify("No conversation point to mark yet", "warning");
				return;
			}
			if (marker.id === targetId) {
				ctx.ui.notify("Marker already points here", "info");
				return;
			}
			marker.apply(pi, ctx, targetId, "Marker set");
		},
	});

	pi.registerCommand("prime", {
		description:
			"Prime the agent on a scope and set a marker when it fully settles",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const scope = args.trim() || INCREMENTAL_WORKFLOW_DEFAULT_PRIME_SCOPE;
			pendingPrimeCount += 1;
			try {
				pi.sendUserMessage(buildPrimePrompt(scope));
			} catch (error) {
				pendingPrimeCount -= 1;
				ctx.ui.notify(
					`Could not start priming: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("end", {
		description:
			"Roll up work since /marker into a summary and advance the marker",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			if (!marker.id) {
				ctx.ui.notify("No marker set. Run /marker first", "warning");
				return;
			}
			if (!ctx.sessionManager.getEntry(marker.id)) {
				ctx.ui.notify(
					"Stored marker no longer exists on this session. Run /marker again",
					"warning",
				);
				return;
			}
			if (getSemanticLeafId(ctx) === marker.id) {
				ctx.ui.notify("Nothing new since the current marker", "info");
				return;
			}

			ctx.ui.setWorkingMessage(
				ctx.ui.theme.fg("dim", "Summarizing increment…"),
			);
			if (ctx.hasUI) {
				ctx.ui.setWidget(
					INCREMENTAL_WORKFLOW_END_WIDGET,
					[ctx.ui.theme.fg("dim", "Summarising back to marker...")],
					{ placement: "aboveEditor" },
				);
			}

			let result: Awaited<ReturnType<typeof ctx.navigateTree>>;
			try {
				const navigationOptions = buildEndNavigationOptions(args);
				let summaryConfig;
				try {
					summaryConfig = readSummaryConfig();
				} catch (error) {
					ctx.ui.notify(
						`Summary configuration unavailable: ${error instanceof Error ? error.message : String(error)}; falling back to the current session model.`,
						"warning",
					);
				}
				result = summaryConfig
					? await navigateWithSummaryModel(
							ctx,
							marker.id,
							navigationOptions,
							summaryConfig,
						)
					: await ctx.navigateTree(marker.id, navigationOptions);
			} finally {
				if (ctx.hasUI) {
					ctx.ui.setWidget(INCREMENTAL_WORKFLOW_END_WIDGET, undefined);
				}
				ctx.ui.setWorkingMessage();
			}

			if (result.cancelled) {
				ctx.ui.notify("/end cancelled", "warning");
				return;
			}
			const nextMarkerId = getSemanticLeafId(ctx);
			if (!nextMarkerId) {
				ctx.ui.notify(
					"/end completed but no new marker point was found",
					"warning",
				);
				return;
			}
			marker.apply(
				pi,
				ctx,
				nextMarkerId,
				"Increment summarized and marker advanced",
			);
		},
	});
}
