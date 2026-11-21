import {
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { SettingsList } from "@earendil-works/pi-tui";
import {
	IDLE_MINUTES,
	NEW_WINDOW_REQUESTS,
	ROLLOVER_TAILS,
	type NotesSettings,
} from "./settings.js";
import { TASK_BOUNDARY_PRESETS, taskBoundaryLabel } from "./task-boundary.js";

export type NotesSettingsAction =
	| "close"
	| "prune"
	| "sessionPruning"
	| "roles"
	| { settings: NotesSettings; selected: string };

const ROLLOVER_TAIL_LABELS = {
	off: "Off",
	conversation: "Conversation",
	full: "Full",
} as const;

export function createNotesSettingsControls(
	ctx: ExtensionContext,
	options: {
		settings: () => NotesSettings;
		settingsPath: string;
	},
	done: (action: NotesSettingsAction) => void,
	requestRender: () => void,
) {
	const settings = options.settings();
	const idleValue = (minutes: number) => {
		if (minutes === 25) return "25m (GPT-5.6–6.1)";
		if (minutes === 55) return "55m (Claude)";
		if (minutes === 115) return "2h (GPT-6.2)";
		return minutes === 0
			? "Off"
			: minutes < 60
				? `${minutes}m`
				: `${Math.ceil(minutes / 60)}h`;
	};
	const list = new SettingsList(
		[
			{
				id: "active",
				label: "Enabled",
				description: `On uses all models. Whitelist matches exact model IDs from any provider. Edit modelWhitelist in ${options.settingsPath}, then reload Pi.`,
				currentValue:
					settings.active === "off"
						? "Off"
						: settings.active === "all"
							? "On"
							: "Whitelist",
				values: ["Off", "On", "Whitelist"],
			},
			{
				id: "sessionPruning",
				label: "Session auto-pruning",
				currentValue: "select…",
				values: ["select…", "settings…"],
				description:
					"Set how long this session keeps older messages and tool activity, or preview a one-time prune. Restart Pi to free memory.",
			},
			{
				id: "roles",
				label: "Roles",
				currentValue: "select…",
				values: ["select…", "view…"],
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
					"Rank matches by relevance (BM25) in user messages and assistant replies no longer in this session’s context. Live context and tool activity still use literal search.",
				currentValue: settings.rankedHistorySearch ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "noteSaveMarkers",
				label: "Note-save markers",
				description:
					"Show the latest fresh save and mark the next prompt in the session tree if it has no label.",
				currentValue: settings.noteSaveMarkers ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "compact",
				label: "Normal compaction",
				description:
					"On summarises older context for /compact and new_context. Off starts from saved notes instead; /compact then waits for your next prompt.",
				currentValue: settings.normalCompaction ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "newWindowRequests",
				label: "New window requests",
				description:
					"Off blocks agent requests. Pi-limits requires enough history for Pi to compact; unrestricted has no size minimum. Does not affect /compact or idle rollover.",
				currentValue: settings.newWindowRequests,
				values: [...NEW_WINDOW_REQUESTS],
			},
			{
				id: "taskCompletionRollover",
				label: "Task-completion rollover",
				description:
					"At task completion, let the agent finish its reply and wait for your next prompt in a fresh window. Off allows only requests that continue immediately.",
				currentValue: settings.taskCompletionRollover ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "taskBoundaryReminder",
				label: "Task-boundary reminder",
				description:
					"Remind the agent to start a fresh window between tasks once usage reaches this threshold. Only for windows larger than 272k tokens. Set taskBoundaryReminder in the notes settings JSON for a custom token count (0 disables).",
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
					"After this idle period, your next message starts a new window if the last turn saved notes. GPT intervals are recommendations, not cache limits.",
				currentValue: idleValue(settings.idleMinutes),
				values: IDLE_MINUTES.map(idleValue),
			},
			{
				id: "rolloverTail",
				label: "Rollover tail",
				description:
					"For notes-only /compact and idle rollover: Conversation keeps user messages, attachments and assistant replies since the last completed Notes save. Full adds complete tool calls and extension messages. Both ask for a save if none qualifies.",
				currentValue: ROLLOVER_TAIL_LABELS[settings.rolloverTail],
				values: ROLLOVER_TAILS.map((mode) => ROLLOVER_TAIL_LABELS[mode]),
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
			if (id === "roles") {
				done("roles");
				return;
			}
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
			const save = (settings: NotesSettings) =>
				done({ settings, selected: id });
			if (id === "active")
				save({
					...current,
					active:
						value === "Off" ? "off" : value === "On" ? "all" : "whitelist",
				});
			else if (id === "sharing")
				save({ ...current, shareSubagentContext: value === "on" });
			else if (id === "noteSaveMarkers")
				save({ ...current, noteSaveMarkers: value === "on" });
			else if (id === "rankedHistorySearch")
				save({ ...current, rankedHistorySearch: value === "on" });
			else if (id === "compact")
				save({ ...current, normalCompaction: value === "on" });
			else if (id === "taskCompletionRollover")
				save({ ...current, taskCompletionRollover: value === "on" });
			else if (id === "rolloverTail") {
				const rolloverTail = ROLLOVER_TAILS.find(
					(mode) => ROLLOVER_TAIL_LABELS[mode] === value,
				);
				if (rolloverTail) save({ ...current, rolloverTail });
			} else if (id === "newWindowRequests") {
				const newWindowRequests = NEW_WINDOW_REQUESTS.find(
					(mode) => mode === value,
				);
				if (newWindowRequests) save({ ...current, newWindowRequests });
			} else if (id === "taskBoundaryReminder")
				save({
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
				if (idleMinutes !== undefined) save({ ...current, idleMinutes });
			}
			requestRender();
		},
		() => done("close"),
		{ enableSearch: false },
	);
	return list;
}
