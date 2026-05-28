/**
 * Incremental workflow extension.
 *
 * Adds two slash commands for long-running repo sessions:
 * - /marker: mark the current conversation point as the baseline checkpoint
 * - /end: roll up work since /marker into a branch summary, jump back, and advance the marker
 *
 * /end modes:
 * - /end        -> use the extension's default workflow-focused summary prompt
 * - /end git    -> default summary prompt plus git commit instructions
 * - /end full   -> use pi's default branch summary prompt
 * - /end <text> -> append custom focus instructions, like /tree custom summary
 *
 * Usage:
 *   pi install npm:@howaboua/pi-auto-trees
 *   # or for local development:
 *   pi --extension ./index.ts
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const INCREMENTAL_WORKFLOW_STATE_ENTRY = "incremental-workflow-state";
export const INCREMENTAL_WORKFLOW_MARKER_LABEL = "marker";
export const INCREMENTAL_WORKFLOW_END_WIDGET = "auto-trees-end";
export const INCREMENTAL_WORKFLOW_DEFAULT_END_PROMPT = [
	"Treat this as a finished work increment that should become durable context for continuing the same repository session.",
	"Focus on the final accepted outcome, not dead ends or step-by-step implementation noise.",
	"Capture the concrete code or repo changes, key decisions, important constraints, and any follow-up that still matters.",
	"Mention relevant files, commands, commits, PR outcomes, or review feedback only when they change future work.",
	"Omit temporary debugging details, abandoned attempts, and incidental churn that no longer matters.",
	"Write the summary so a future agent can continue from the repo familiarization and planning context plus this completed increment.",
].join("\n");
export const INCREMENTAL_WORKFLOW_GIT_END_PROMPT = [
	INCREMENTAL_WORKFLOW_DEFAULT_END_PROMPT,
	"Also explicitly capture the git commit that should be made for the completed changes, including a concise commit subject and any important commit-body notes.",
].join("\n");

interface IncrementalWorkflowState {
	version: 1;
	markerId: string;
}

type EndMode =
	| { mode: "default" }
	| { mode: "git" }
	| { mode: "full" }
	| { mode: "custom"; prompt: string };

function isIncrementalWorkflowState(
	value: unknown,
): value is IncrementalWorkflowState {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { version?: unknown; markerId?: unknown };
	return candidate.version === 1 && typeof candidate.markerId === "string";
}

function readStateFromBranch(
	ctx: ExtensionContext,
): IncrementalWorkflowState | undefined {
	let state: IncrementalWorkflowState | undefined;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (
			entry.type !== "custom" ||
			entry.customType !== INCREMENTAL_WORKFLOW_STATE_ENTRY
		)
			continue;
		if (isIncrementalWorkflowState(entry.data)) {
			state = entry.data;
		}
	}

	return state;
}

function getSemanticLeafId(ctx: ExtensionContext): string | undefined {
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

function parseEndMode(args: string): EndMode {
	const trimmed = args.trim();
	if (!trimmed) return { mode: "default" };
	if (trimmed.toLowerCase() === "git") return { mode: "git" };
	if (trimmed.toLowerCase() === "full") return { mode: "full" };
	return { mode: "custom", prompt: trimmed };
}

function buildEndNavigationOptions(mode: EndMode): {
	summarize: true;
	customInstructions?: string;
	replaceInstructions?: boolean;
} {
	switch (mode.mode) {
		case "full":
			return { summarize: true };
		case "git":
			return {
				summarize: true,
				customInstructions: INCREMENTAL_WORKFLOW_GIT_END_PROMPT,
				replaceInstructions: false,
			};
		case "custom":
			return {
				summarize: true,
				customInstructions: mode.prompt,
				replaceInstructions: false,
			};
		case "default":
			return {
				summarize: true,
				customInstructions: INCREMENTAL_WORKFLOW_DEFAULT_END_PROMPT,
				replaceInstructions: false,
			};
	}
}

export default function (pi: ExtensionAPI) {
	let markerId: string | undefined;

	const refreshState = (ctx: ExtensionContext) => {
		markerId = readStateFromBranch(ctx)?.markerId;
	};

	const applyMarker = (
		ctx: ExtensionContext,
		nextMarkerId: string,
		notifyMessage: string,
	): void => {
		const previousMarkerId = markerId;

		if (
			previousMarkerId &&
			previousMarkerId !== nextMarkerId &&
			ctx.sessionManager.getLabel(previousMarkerId) ===
				INCREMENTAL_WORKFLOW_MARKER_LABEL
		) {
			pi.setLabel(previousMarkerId, undefined);
		}

		let labelNote = "";
		const existingLabel = ctx.sessionManager.getLabel(nextMarkerId);
		if (
			existingLabel === undefined ||
			existingLabel === INCREMENTAL_WORKFLOW_MARKER_LABEL
		) {
			pi.setLabel(nextMarkerId, INCREMENTAL_WORKFLOW_MARKER_LABEL);
		} else {
			labelNote = ` Existing label "${existingLabel}" kept.`;
		}

		pi.appendEntry(INCREMENTAL_WORKFLOW_STATE_ENTRY, {
			version: 1,
			markerId: nextMarkerId,
		} satisfies IncrementalWorkflowState);
		markerId = nextMarkerId;

		ctx.ui.notify(`${notifyMessage}${labelNote}`, "info");
	};

	pi.on("session_start", async (_event, ctx) => refreshState(ctx));
	pi.on("session_tree", async (_event, ctx) => refreshState(ctx));

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

			if (markerId === targetId) {
				ctx.ui.notify("Marker already points here", "info");
				return;
			}

			applyMarker(ctx, targetId, "Marker set");
		},
	});

	pi.registerCommand("end", {
		description:
			"Roll up work since /marker into a summary and advance the marker",
		handler: async (args, ctx) => {
			const clearEndFeedback = () => {
				if (ctx.hasUI) {
					ctx.ui.setWidget(INCREMENTAL_WORKFLOW_END_WIDGET, undefined);
				}
				ctx.ui.setWorkingMessage();
			};

			await ctx.waitForIdle();

			if (!markerId) {
				ctx.ui.notify("No marker set. Run /marker first", "warning");
				return;
			}

			if (!ctx.sessionManager.getEntry(markerId)) {
				ctx.ui.notify(
					"Stored marker no longer exists on this session. Run /marker again",
					"warning",
				);
				return;
			}

			const currentSemanticLeafId = getSemanticLeafId(ctx);
			if (currentSemanticLeafId === markerId) {
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
				result = await ctx.navigateTree(
					markerId,
					buildEndNavigationOptions(parseEndMode(args)),
				);
			} finally {
				clearEndFeedback();
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

			applyMarker(
				ctx,
				nextMarkerId,
				"Increment summarized and marker advanced",
			);
		},
	});
}
