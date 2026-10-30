import {
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { SettingsList } from "@earendil-works/pi-tui";
import {
	IDLE_MINUTES,
	NEW_WINDOW_REQUESTS,
	type NotesSettings,
} from "./settings.js";
import { TASK_BOUNDARY_PRESETS, taskBoundaryLabel } from "./task-boundary.js";

export function createNotesSettingsControls(
	ctx: ExtensionContext,
	options: {
		settings: () => NotesSettings;
		settingsPath: string;
		save: (settings: NotesSettings) => void;
	},
	done: (action: "close" | "prune" | "sessionPruning") => void,
	requestRender: () => void,
) {
	const settings = options.settings();
	const idleValue = (minutes: number) =>
		minutes === 0
			? "Off"
			: minutes < 60
				? `${minutes}m`
				: `${Math.ceil(minutes / 60)}h`;
	const list = new SettingsList(
		[
			{
				id: "sessionPruning",
				label: "Session auto-pruning",
				currentValue: "select…",
				values: ["select…", "settings…"],
				description:
					"Per-session history limits and Run now. Memory savings require restarting Pi.",
			},
			{
				id: "active",
				label: "Active",
				description: `Whitelist matches exact model IDs from any provider. Edit modelWhitelist in ${options.settingsPath}, then reload Pi. Example: ["gpt-6-luna", "gpt-6.1-sol"].`,
				currentValue: settings.active === "all" ? "All models" : "Whitelist",
				values: ["All models", "Whitelist"],
			},
			{
				id: "sharing",
				label: "Share subagent context",
				description:
					"Let new child agents share notes and history. Existing families remain connected when off.",
				currentValue: settings.shareSubagentContext ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "rankedHistorySearch",
				label: "Ranked history search",
				description:
					"BM25 for earlier user messages and assistant replies. Skips current context and tool activity.",
				currentValue: settings.rankedHistorySearch ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "noteSaveMarkers",
				label: "Note-save markers",
				currentValue: settings.noteSaveMarkers ? "on" : "off",
				values: ["off", "on"],
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
				id: "newWindowRequests",
				label: "New window requests",
				description:
					"Off disables new_context. Pi-limits keeps the current window when Pi finds too little history to compact. Unrestricted accepts requests at any size. Normal compaction still chooses how windows roll over. Manual /compact and idle rollover are separate.",
				currentValue: settings.newWindowRequests,
				values: [...NEW_WINDOW_REQUESTS],
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
					"Remove notes, cached responses and history index entries for missing session files. Keeps the active session, unknown paths and inaccessible files. Confirmation required.",
				currentValue: "select…",
				values: ["select…", "prune…"],
			},
		],
		5,
		getSettingsListTheme(),
		(id, value) => {
			if (id === "sessionPruning") {
				done("sessionPruning");
				return;
			}
			if (id === "prune") {
				done("prune");
				return;
			}
			const current = options.settings();
			if (id === "taskBoundaryReminder" && value === "custom (edit JSON)") {
				ctx.ui.notify(
					`Set taskBoundaryReminder to a positive whole token count in ${options.settingsPath}, then reload Pi. 0 is off.`,
					"info",
				);
				list.updateValue(id, taskBoundaryLabel(current.taskBoundaryReminder));
				return;
			}
			try {
				if (id === "active")
					options.save({
						...current,
						active: value === "All models" ? "all" : "whitelist",
					});
				else if (id === "sharing")
					options.save({
						...current,
						shareSubagentContext: value === "on",
					});
				else if (id === "noteSaveMarkers")
					options.save({ ...current, noteSaveMarkers: value === "on" });
				else if (id === "rankedHistorySearch")
					options.save({
						...current,
						rankedHistorySearch: value === "on",
					});
				else if (id === "compact")
					options.save({ ...current, normalCompaction: value === "on" });
				else if (id === "newWindowRequests") {
					const newWindowRequests = NEW_WINDOW_REQUESTS.find(
						(mode) => mode === value,
					);
					if (newWindowRequests)
						options.save({ ...current, newWindowRequests });
				} else if (id === "taskBoundaryReminder")
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
				if (id === "rankedHistorySearch") {
					list.updateValue(id, current.rankedHistorySearch ? "on" : "off");
				} else
					list.updateValue(
						id,
						id === "active"
							? current.active === "all"
								? "All models"
								: "Whitelist"
							: id === "taskBoundaryReminder"
								? taskBoundaryLabel(current.taskBoundaryReminder)
								: id === "newWindowRequests"
									? current.newWindowRequests
									: id === "noteSaveMarkers"
										? current.noteSaveMarkers
											? "on"
											: "off"
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
			requestRender();
		},
		() => done("close"),
		{ enableSearch: false },
	);
	return list;
}
