import {
	type ExtensionAPI,
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	SettingsList,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	type BoardScope,
	readBoardSummaryConfig,
	resolveBoardSummaryModel,
	writeBoardSummarySelection,
} from "../config.js";
import { requestBoardConsolidation } from "../consolidation.js";
import { binding } from "../identity.js";
import type { BoardRuntime } from "../runtime/coordinator.js";

type Action = { id: string; value: string } | "close" | "notes";

export async function openBoardSettings(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	board: BoardRuntime,
): Promise<"notes" | undefined> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Use /board settings in an interactive session", "warning");
		return;
	}
	let scope: BoardScope = "session";
	let selected = "scope";
	const sessionId = ctx.sessionManager.getSessionId();
	while (true) {
		try {
			const config = readBoardSummaryConfig(ctx.cwd);
			const action = await ctx.ui.custom<Action>((tui, theme, _kb, done) => {
				const list = new SettingsList(
					[
						{
							id: "scope",
							label: "Scope",
							currentValue: scope,
							values: ["session", "folder", "global"],
						},
						{
							id: "enabled",
							label: "Board",
							currentValue: board.enabled(ctx) ? "on" : "off",
							values: ["off", "on"],
						},
						{
							id: "automatic",
							label: "Automatic summaries",
							description: "Summarise on closure. Uses model quota.",
							currentValue: config.automatic ? "on" : "off",
							values: ["off", "on"],
						},
						{
							id: "model",
							label: "Summary model",
							description: "Global preference.",
							currentValue: config.selection === "luna" ? "Luna" : "Custom",
							values: ["Luna", "Custom"],
						},
						{
							id: "consolidate",
							label: "Consolidate one-off threads",
							description: "Sends a prompt to this session's agent.",
							currentValue: "select…",
							values: ["select…", "run…"],
						},
						{
							id: "viewer",
							label: "Open viewer",
							currentValue: "select…",
							values: ["select…", "open…"],
						},
					],
					6,
					getSettingsListTheme(),
					(id, value) => done({ id, value }),
					() => done("close"),
					{ enableSearch: false },
				);
				list.selectItem(selected);
				return {
					render(width) {
						const wrap = (text: string) =>
							wrapTextWithAnsi(text, Math.max(1, width - 2)).map(
								(line) => `  ${line}`,
							);
						const rule = theme.fg("accent", "─".repeat(Math.max(0, width)));
						return [
							rule,
							`  ${theme.fg("dim", "Notes")}  /  ${theme.bold("Board")}`,
							"",
							...wrap(board.status(ctx, false)),
							"",
							...list.render(width).slice(0, -2),
							"",
							...wrap(
								"Tab switch tab · ↑/↓ select · Enter/Space change · Esc close",
							).map((line) => theme.fg("dim", line)),
							rule,
						].map((line) => truncateToWidth(line, width, ""));
					},
					invalidate: () => list.invalidate(),
					handleInput(data) {
						if (
							matchesKey(data, Key.tab) ||
							matchesKey(data, Key.shift(Key.tab))
						)
							return done("notes");
						list.handleInput(data);
						tui.requestRender();
					},
				};
			});
			if (action === "close") return;
			if (action === "notes") return "notes";
			selected = action.id;
			if (ctx.sessionManager.getSessionId() !== sessionId)
				throw new Error("Session changed; reopen Board settings");
			if (action.id === "scope") {
				if (
					action.value === "session" ||
					action.value === "folder" ||
					action.value === "global"
				)
					scope = action.value;
				continue;
			}
			if (binding(ctx).upstream)
				throw new Error("Change Board settings in the owning root session");
			if (action.id === "enabled")
				await board.setSetting(ctx, scope, action.value === "on");
			else if (action.id === "automatic")
				board.setAutomaticSummaries(ctx, action.value === "on");
			else if (action.id === "model") {
				writeBoardSummarySelection(
					ctx.cwd,
					action.value === "Luna" ? "luna" : "custom",
				);
				try {
					resolveBoardSummaryModel(ctx.cwd);
				} catch (error) {
					ctx.ui.notify(
						`Custom selected. ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
					continue;
				}
				ctx.ui.notify(
					action.value === "Custom"
						? `Board summary model: Custom. Edit board.summary.custom in ${config.path}: set provider, model and reasoning.`
						: "Board summary model: Luna (high).",
					"info",
				);
			} else if (action.id === "consolidate") {
				requestBoardConsolidation(pi, ctx);
				return;
			} else if (action.id === "viewer") {
				const { openBoardViewer } = await import("../viewer/index.js");
				await openBoardViewer(pi, ctx, (context, sessionName) => {
					const own = binding(context);
					if (own.upstream)
						throw new Error(
							"Open /board in the owning root session to view this shared board",
						);
					return {
						sessionId: own.sessionId,
						sessionName: sessionName ?? null,
						boardId: own.boardId,
						folder: own.ownerFolder,
						databasePath: own.databasePath,
					};
				});
			}
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
			return;
		}
	}
}
