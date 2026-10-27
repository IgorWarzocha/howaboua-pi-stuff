import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	readBoardSummaryConfig,
	resolveBoardSummaryModel,
	writeBoardSummarySelection,
} from "../config.js";
import { requestBoardConsolidation } from "../consolidation.js";
import { binding } from "../identity.js";
import type { BoardRuntime } from "../runtime/coordinator.js";

export async function openBoardSettings(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	board: BoardRuntime,
) {
	if (!ctx.hasUI) {
		ctx.ui.notify("Use /board settings in an interactive session", "warning");
		return;
	}
	try {
		if (binding(ctx).upstream)
			throw new Error("Change Board settings in the owning root session");
		const sessionId = ctx.sessionManager.getSessionId();
		const consolidate =
			"Consolidate one-off threads (sends a prompt to this session's agent)";
		const setting = await ctx.ui.select("Board settings and actions", [
			"Automatic summaries",
			"Summary model",
			consolidate,
		]);
		if (setting === consolidate) {
			if (ctx.sessionManager.getSessionId() !== sessionId)
				throw new Error("Session changed; reopen Board settings");
			requestBoardConsolidation(pi, ctx);
			return;
		}
		if (!setting) return;
		const config = readBoardSummaryConfig(ctx.cwd);
		if (setting === "Automatic summaries") {
			const selected = await ctx.ui.select(
				`Automatic summaries: ${config.automatic ? "on" : "off"}. Summarise on closure? Uses model quota.`,
				["Off", "On"],
			);
			if (selected !== "Off" && selected !== "On") return;
			board.setAutomaticSummaries(ctx, selected === "On");
			ctx.ui.notify(
				`Automatic board summaries: ${selected.toLowerCase()}.`,
				"info",
			);
			return;
		}
		if (setting !== "Summary model") return;
		const selected = await ctx.ui.select(
			`Board summary model (global; current: ${config.selection === "luna" ? "Luna" : "Custom"})`,
			["Luna", "Custom"],
		);
		if (selected !== "Luna" && selected !== "Custom") return;
		writeBoardSummarySelection(
			ctx.cwd,
			selected === "Luna" ? "luna" : "custom",
		);
		try {
			resolveBoardSummaryModel(ctx.cwd);
		} catch (error) {
			ctx.ui.notify(
				`Custom selected. ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
			return;
		}
		ctx.ui.notify(
			selected === "Custom"
				? `Board summary model: Custom. Edit board.summary.custom in ${config.path}: set provider, model and reasoning.`
				: "Board summary model: Luna (high).",
			"info",
		);
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	}
	return;
}
