import {
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
import type { ModelRole } from "./model-role-config.js";

export function openModelRoleScreen(
	ctx: ExtensionContext,
	choices: string[],
	roles: ModelRole[],
) {
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const list = new SettingsList(
			choices.map((choice) => ({
				id: choice,
				label: choice,
				currentValue: "select…",
				values: ["select…", "open…"],
			})),
			8,
			getSettingsListTheme(),
			(id) => done(id),
			() => done(undefined),
		);
		return {
			render: (width: number) =>
				[
					`  ${theme.fg("dim", "Notes")}  /  ${theme.bold("Roles")}`,
					"",
					...roles.flatMap((role) =>
						wrapTextWithAnsi(
							`  ${role.id}: ${role.provider}/${role.model} (${role.reasoning})\n  ${role.description}`,
							width,
						),
					),
					"",
					...list.render(width),
					"  Tab switch tab · ↑/↓ select · Enter change · Esc close",
				].map((line) => truncateToWidth(line, width)),
			invalidate: () => list.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift(Key.tab))) {
					done("notes-tab");
					return;
				}
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}
