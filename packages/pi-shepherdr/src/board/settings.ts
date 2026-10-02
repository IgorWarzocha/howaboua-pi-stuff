import {
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentBoard } from "./host.js";

export async function openBoardSettings(
	ctx: ExtensionContext,
	board: AgentBoard,
) {
	// Check root ownership and configuration before opening the menu.
	let settings = board.settings(ctx);
	let status = board.status(ctx);
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		let busy = false;
		const items = () => {
			const value = (enabled: boolean | undefined) =>
				enabled === undefined ? "inherit" : enabled ? "on" : "off";
			return [
				{
					id: "session",
					label: "This session",
					currentValue: value(settings.session),
					values: ["inherit", "on", "off"],
				},
				{
					id: "folder",
					label: "This folder",
					currentValue: value(settings.folder),
					values: ["inherit", "on", "off"],
				},
				{
					id: "global",
					label: "Enable globally",
					currentValue: value(settings.global),
					values: ["off", "on"],
				},
			];
		};
		const restoreValues = () => {
			for (const item of items()) list.updateValue(item.id, item.currentValue);
			tui.requestRender();
		};
		const reload = () => {
			status = board.status(ctx);
			try {
				settings = board.settings(ctx);
			} catch (error) {
				ctx.ui.notify(String(error), "error");
			}
			restoreValues();
		};
		const list = new SettingsList(
			items(),
			3,
			getSettingsListTheme(),
			(id, value) => {
				if (id !== "session" && id !== "folder" && id !== "global") return;
				if (busy) {
					restoreValues();
					return;
				}
				busy = true;
				void board
					.setSetting(ctx, id, value === "inherit" ? undefined : value === "on")
					.catch((error: unknown) => ctx.ui.notify(String(error), "error"))
					.finally(() => {
						busy = false;
						reload();
					});
			},
			() => {
				if (!busy) done(undefined);
			},
		);
		return {
			render(width: number) {
				return [
					theme.bold("Shepherdr message board"),
					"",
					...list.render(width),
					"",
					...status.split("\n"),
					`Folder config: ${settings.paths.folder}`,
					`Global config: ${settings.paths.global}`,
					"Session overrides folder; folder overrides global. Folder settings never cover child directories.",
					"Enter/Space to change · Esc to close",
				].map((line) => truncateToWidth(line, width, ""));
			},
			invalidate: () => list.invalidate(),
			handleInput(data: string) {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}
