import {
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	SettingsList,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { IDLE_MINUTES, type NotesSettings } from "./settings.js";
import { TASK_BOUNDARY_PRESETS, taskBoundaryLabel } from "./task-boundary.js";

export async function openNotesSettings(
	ctx: ExtensionContext,
	options: {
		settings: () => NotesSettings;
		settingsPath: string;
		save: (settings: NotesSettings) => void;
		status: () => string[];
		prune: () => Promise<void>;
	},
): Promise<void> {
	while (true) {
		const action = await ctx.ui.custom<"close" | "prune">(
			(tui, theme, _kb, done) => {
				const settings = options.settings();
				const idleValue = (minutes: number) =>
					minutes === 0 ? "off" : `${minutes} min`;
				const list = new SettingsList(
					[
						{
							id: "active",
							label: "Active",
							description: `Whitelist matches exact model IDs from any provider. Edit modelWhitelist in ${options.settingsPath}, then reload Pi. Example: ["gpt-6-luna", "gpt-6.1-sol"].`,
							currentValue:
								settings.active === "all" ? "All models" : "Whitelist",
							values: ["All models", "Whitelist"],
						},
						{
							id: "compact",
							label: "Normal compaction",
							description:
								"Use Pi/PCC compaction for /compact and new_context. Off uses notes-only rollover; /compact then waits for your next prompt.",
							currentValue: settings.normalCompaction ? "on" : "off",
							values: ["off", "on"],
						},
						{
							id: "taskBoundaryReminder",
							label: "Task-boundary reminder",
							description:
								"Suggest a separate-task rollover after this many used tokens, only with active capacity above 272k. Custom: edit taskBoundaryReminder in the notes settings JSON (whole tokens); 0 is off.",
							currentValue: taskBoundaryLabel(settings.taskBoundaryReminder),
							values: [
								...TASK_BOUNDARY_PRESETS.map(taskBoundaryLabel),
								"custom (edit JSON)",
							],
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
						if (
							id === "taskBoundaryReminder" &&
							value === "custom (edit JSON)"
						) {
							ctx.ui.notify(
								`Set taskBoundaryReminder to a positive whole token count in ${options.settingsPath}, then reload Pi. 0 is off.`,
								"info",
							);
							list.updateValue(
								id,
								taskBoundaryLabel(current.taskBoundaryReminder),
							);
							return;
						}
						try {
							if (id === "active")
								options.save({
									...current,
									active: value === "All models" ? "all" : "whitelist",
								});
							else if (id === "compact")
								options.save({ ...current, normalCompaction: value === "on" });
							else if (id === "taskBoundaryReminder")
								options.save({
									...current,
									taskBoundaryReminder:
										TASK_BOUNDARY_PRESETS.find(
											(tokens) => taskBoundaryLabel(tokens) === value,
										) ?? current.taskBoundaryReminder,
								});
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
								id === "active"
									? current.active === "all"
										? "All models"
										: "Whitelist"
									: id === "taskBoundaryReminder"
										? taskBoundaryLabel(current.taskBoundaryReminder)
										: id === "compact"
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
					render: (width) => {
						const wrap = (text: string) =>
							wrapTextWithAnsi(text, Math.max(1, width - 2)).map(
								(line) => `  ${line}`,
							);
						const rule = theme.fg("accent", "─".repeat(Math.max(0, width)));
						return [
							rule,
							`  ${theme.bold("Notes & context")}`,
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
							...wrap("↑/↓ select · Enter/Space change · Esc close").map(
								(line) => theme.fg("dim", line),
							),
							...wrap("Settings saved immediately").map((line) =>
								theme.fg("dim", line),
							),
							rule,
						].map((line) => truncateToWidth(line, width, ""));
					},
					invalidate: () => list.invalidate(),
					handleInput: (data) => {
						list.handleInput(data);
						tui.requestRender();
					},
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
