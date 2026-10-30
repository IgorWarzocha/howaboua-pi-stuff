import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	openSessionPruningSettings,
	type SessionPruningSettings,
} from "./session-pruning-screen.js";
import type { NotesSettings } from "./settings.js";
import { createNotesSettingsControls } from "./settings-controls.js";

type ScreenAction = "close" | "prune" | "sessionPruning" | "roles";

export async function openNotesSettings(
	ctx: ExtensionContext,
	options: {
		settings: () => NotesSettings;
		settingsPath: string;
		save: (settings: NotesSettings) => void;
		status: () => string[];
		prune: () => Promise<void>;
		sessionPruning: SessionPruningSettings;
	},
): Promise<"roles" | undefined> {
	while (true) {
		const action = await ctx.ui.custom<ScreenAction>(
			(tui, theme, _kb, done) => {
				const list = createNotesSettingsControls(ctx, options, done, () =>
					tui.requestRender(),
				);
				return {
					render: (width) => {
						const wrap = (text: string) =>
							wrapTextWithAnsi(text, Math.max(1, width - 2)).map(
								(line) => `  ${line}`,
							);
						const rule = theme.fg("accent", "─".repeat(Math.max(0, width)));
						return [
							rule,
							`  ${theme.bold("Notes")}  /  ${theme.fg("dim", "Roles")}`,
							"",
							...options
								.status()
								.flatMap((line) =>
									wrap(line).map((part) => theme.fg("dim", part)),
								),
							"",
							...wrap(
								"This extension works best on GPT6+ models. For other models we recommend switching the active option to whitelist or switching normal compaction on to work alongside the notes system.",
							),
							"",
							...list.render(width).slice(0, -2),
							"",
							...wrap(
								"Tab switch tab · ↑/↓ select · Enter/Space change · Esc close",
							).map((line) => theme.fg("dim", line)),
							...wrap("Settings saved immediately").map((line) =>
								theme.fg("dim", line),
							),
							rule,
						].map((line) => truncateToWidth(line, width, ""));
					},
					invalidate: () => list.invalidate(),
					handleInput: (data) => {
						if (
							matchesKey(data, Key.tab) ||
							matchesKey(data, Key.shift(Key.tab))
						) {
							done("roles");
							return;
						}
						list.handleInput(data);
						tui.requestRender();
					},
				};
			},
		);
		if (action === "close") return;
		if (action === "roles") return "roles";
		if (action === "sessionPruning") {
			await openSessionPruningSettings(ctx, options.sessionPruning);
			continue;
		}
		if (
			await ctx.ui.confirm(
				"Prune missing sessions?",
				"Delete local notes, cached responses and history index entries for missing session files? The active session, unknown paths and inaccessible files are retained.",
			)
		)
			await options.prune();
	}
}
