import {
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import { IDLE_MINUTES, type NotesSettings } from "./settings.js";

export async function openNotesSettings(
	ctx: ExtensionContext,
	options: {
		settings: () => NotesSettings;
		save: (settings: NotesSettings) => void;
		status: () => string[];
		prune: () => Promise<void>;
	},
): Promise<void> {
	while (true) {
		const status = options.status();
		const action = await ctx.ui.custom<"close" | "prune">(
			(tui, theme, _kb, done) => {
				const settings = options.settings();
				const idleValue = (minutes: number) =>
					minutes === 0 ? "off" : `${minutes} min`;
				const list = new SettingsList(
					[
						{
							id: "compact",
							label: "Normal compaction",
							description:
								"Include the installed Pi/PCC compaction flow on new_context. Off keeps notes-only rollover.",
							currentValue: settings.normalCompaction ? "on" : "off",
							values: ["off", "on"],
						},
						{
							id: "idle",
							label: "Idle rollover",
							description:
								"Roll over before the next input only with fresh notes from a completed turn. Not a cache-expiry guarantee.",
							currentValue: idleValue(settings.idleMinutes),
							values: IDLE_MINUTES.map(idleValue),
						},
						{
							id: "prune",
							label: "Prune missing sessions",
							description:
								"Remove stored records only for missing session files. Keeps active sessions, unknown paths and inaccessible files. Confirmation required.",
							currentValue: "select…",
							values: ["select…", "prune…"],
						},
					],
					5,
					getSettingsListTheme(),
					(id, value) => {
						if (id === "prune") {
							done("prune");
							return;
						}
						const current = options.settings();
						try {
							if (id === "compact")
								options.save({ ...current, normalCompaction: value === "on" });
							else {
								const idleMinutes = IDLE_MINUTES.find(
									(minutes) => idleValue(minutes) === value,
								);
								if (idleMinutes !== undefined)
									options.save({ ...current, idleMinutes });
							}
						} catch (error) {
							list.updateValue(
								id,
								id === "compact"
									? current.normalCompaction
										? "on"
										: "off"
									: idleValue(current.idleMinutes),
							);
							ctx.ui.notify(
								`Could not save notes settings: ${String(error)}`,
								"error",
							);
						}
						tui.requestRender();
					},
					() => done("close"),
					{ enableSearch: false },
				);
				return {
					render: (width) =>
						[
							theme.fg("accent", "Notes & context"),
							...status.map((line) => theme.fg("dim", line)),
							"",
							...list.render(width),
							"",
							theme.fg(
								"dim",
								"↑↓ navigate · Enter/Space change · Esc close · saved immediately",
							),
						].map((line) => truncateToWidth(line, width)),
					invalidate: () => list.invalidate(),
					handleInput: (data) => list.handleInput(data),
				};
			},
		);
		if (action === "close") return;
		if (
			await ctx.ui.confirm(
				"Prune missing sessions?",
				"Delete local notes and cached responses for missing session files? The active session, unknown paths and inaccessible files are retained.",
			)
		)
			await options.prune();
	}
}
