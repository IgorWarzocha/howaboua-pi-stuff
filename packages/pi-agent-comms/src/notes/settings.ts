import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
	commsSettingsPath,
	isSettingsObject,
	readSettingsFile,
	writeSettingsFile,
} from "../settings-file.js";

// Hour presets store their effective duration, with five minutes of headroom.
export const IDLE_MINUTES = [0, 25, 55, 115, 355, 715] as const;
export type IdleMinutes = (typeof IDLE_MINUTES)[number] | 5 | 15;
export const NEW_WINDOW_REQUESTS = [
	"off",
	"pi-limits",
	"unrestricted",
] as const;
export type NewWindowRequests = (typeof NEW_WINDOW_REQUESTS)[number];
export const ROLLOVER_TAILS = ["off", "conversation", "full"] as const;
export type RolloverTailMode = (typeof ROLLOVER_TAILS)[number];
const DEFAULT_MODEL_WHITELIST = ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6-luna"];
export interface NotesSettings {
	active: "all" | "whitelist" | "off";
	modelWhitelist: string[];
	normalCompaction: boolean;
	noteSaveMarkers: boolean;
	rankedHistorySearch: boolean;
	shareSubagentContext: boolean;
	newWindowRequests: NewWindowRequests;
	taskCompletionRollover: boolean;
	idleMinutes: IdleMinutes;
	rolloverTail: RolloverTailMode;
	taskBoundaryReminder: number;
}

export function notesDataDir(): string {
	return join(getAgentDir(), "notes-compaction");
}

function legacySettingsPaths(ctx: ExtensionContext): string[] {
	return [
		join(getAgentDir(), "pi-codex-conversion.json"),
		...(ctx.isProjectTrusted()
			? [join(ctx.cwd, CONFIG_DIR_NAME, "pi-codex-conversion.json")]
			: []),
	];
}

export function loadNotesSettings(ctx: ExtensionContext): NotesSettings {
	const path = commsSettingsPath();
	const current = readSettingsFile(path) ?? {};
	const previousPath = join(notesDataDir(), "settings.json");
	const previous = readSettingsFile(previousPath);
	const paths = legacySettingsPaths(ctx);
	if (current["notes"] !== undefined && previous === undefined)
		return readSettings(path, current["notes"], paths);
	const settings = readSettings(
		current["notes"] === undefined ? previousPath : path,
		current["notes"] === undefined ? previous : current["notes"],
		paths,
	);
	writeSettingsFile(path, {
		...current,
		notes: {
			...previous,
			...(isSettingsObject(current["notes"]) ? current["notes"] : {}),
			...settings,
		},
	});
	if (previous !== undefined) rmSync(previousPath, { force: true });
	return settings;
}

export function legacyNotesConfigured(ctx: ExtensionContext): boolean {
	const { compaction } = readLegacyPreferences(legacySettingsPaths(ctx));
	return (
		compaction["continuity"] === "notes" ||
		compaction["continuity"] === "notes-and-compaction"
	);
}

function readSettings(
	path: string,
	settings: unknown,
	legacyPaths: readonly string[] = [],
): NotesSettings {
	let legacy: ReturnType<typeof readLegacyPreferences> | undefined;
	const preferences = () => (legacy ??= readLegacyPreferences(legacyPaths));
	if (settings === undefined)
		return (
			readLegacySettings(preferences()) ?? {
				active: "off",
				modelWhitelist: [...DEFAULT_MODEL_WHITELIST],
				normalCompaction: false,
				rankedHistorySearch: false,
				noteSaveMarkers: preferences().noteSaveMarkers,
				shareSubagentContext: false,
				newWindowRequests: "unrestricted",
				taskCompletionRollover: false,
				idleMinutes: 0,
				rolloverTail: "off",
				taskBoundaryReminder: 0,
			}
		);
	if (
		!settings ||
		typeof settings !== "object" ||
		!("normalCompaction" in settings) ||
		typeof settings.normalCompaction !== "boolean"
	)
		throw new Error(
			"Invalid notes settings. Save a setting in /notes, then reload Pi.",
		);
	const active = "active" in settings ? settings.active : "all";
	if (active !== "all" && active !== "whitelist" && active !== "off")
		throw new Error(
			`Invalid active setting in ${path}. Use "all", "whitelist" or "off", then reload Pi.`,
		);
	const modelWhitelist =
		"modelWhitelist" in settings
			? settings.modelWhitelist
			: [...DEFAULT_MODEL_WHITELIST];
	if (
		!Array.isArray(modelWhitelist) ||
		!modelWhitelist.every((id): id is string => typeof id === "string")
	)
		throw new Error(
			`Invalid modelWhitelist in ${path}. Use an array of model ID strings, then reload Pi.`,
		);
	const idleMinutes = "idleMinutes" in settings ? settings.idleMinutes : 0;
	const rolloverTail = parseRolloverTail(
		"rolloverTail" in settings ? settings.rolloverTail : "off",
	);
	if (!rolloverTail)
		throw new Error(
			"Invalid rollover tail. Choose Off, Conversation or Full in /notes.",
		);
	const rankedHistorySearch =
		"rankedHistorySearch" in settings ? settings.rankedHistorySearch : false;
	if (typeof rankedHistorySearch !== "boolean")
		throw new Error(
			`Invalid rankedHistorySearch in ${path}. Use true or false, then reload Pi.`,
		);
	const newWindowRequests =
		"newWindowRequests" in settings
			? settings.newWindowRequests
			: "unrestricted";
	if (!NEW_WINDOW_REQUESTS.some((value) => value === newWindowRequests))
		throw new Error(
			"Invalid new window requests setting. Choose off, pi-limits or unrestricted in /notes.",
		);
	const taskBoundaryReminder =
		"taskBoundaryReminder" in settings ? settings.taskBoundaryReminder : 0;
	const taskCompletionRollover =
		"taskCompletionRollover" in settings
			? settings.taskCompletionRollover
			: false;
	if (typeof taskCompletionRollover !== "boolean")
		throw new Error(
			"Invalid task-completion rollover setting. Choose on or off in /notes.",
		);
	if (
		typeof taskBoundaryReminder !== "number" ||
		!Number.isSafeInteger(taskBoundaryReminder) ||
		taskBoundaryReminder < 0
	)
		throw new Error(
			"Invalid task-boundary reminder setting. Save a setting in /notes, then reload Pi.",
		);
	if (
		idleMinutes !== 5 &&
		idleMinutes !== 15 &&
		!IDLE_MINUTES.some((value) => value === idleMinutes)
	)
		throw new Error(
			"Invalid idle rollover interval. Set idleMinutes to 0, 25, 55, 115, 355 or 715, then reload Pi.",
		);
	return {
		active,
		modelWhitelist,
		normalCompaction: settings.normalCompaction,
		rankedHistorySearch,
		noteSaveMarkers:
			"noteSaveMarkers" in settings
				? settings.noteSaveMarkers === true
				: preferences().noteSaveMarkers,
		shareSubagentContext:
			"shareSubagentContext" in settings
				? settings.shareSubagentContext === true
				: preferences().compaction["shareSubagentContext"] === true,
		newWindowRequests: newWindowRequests as NewWindowRequests,
		taskCompletionRollover,
		idleMinutes: idleMinutes as IdleMinutes,
		rolloverTail,
		taskBoundaryReminder,
	};
}

export function modelIsActive(
	settings: NotesSettings,
	model?: { id: string },
): boolean {
	return (
		settings.active === "all" ||
		(settings.active === "whitelist" &&
			Boolean(model && settings.modelWhitelist.includes(model.id)))
	);
}

export function writeSettings(settings: NotesSettings): void {
	const path = commsSettingsPath();
	const document = readSettingsFile(path) ?? {};
	const previous = document["notes"];
	if (previous !== undefined && !isSettingsObject(previous))
		throw new Error(`${path}: notes must be an object`);
	writeSettingsFile(path, { ...document, notes: { ...previous, ...settings } });
}

/** Import only on first use. An existing Notes settings file always wins. */
function readLegacySettings(
	preferences: ReturnType<typeof readLegacyPreferences>,
): NotesSettings | undefined {
	const value = preferences.compaction;
	if (!["notes", "notes-and-compaction"].includes(String(value["continuity"])))
		return;
	const oldIdle = value["idleNotesRollover"];
	const idle = oldIdle === true ? 25 : oldIdle === false ? 0 : (oldIdle ?? 0);
	const requests =
		"newWindowRequests" in value ? value["newWindowRequests"] : "unrestricted";
	const reminder =
		"taskBoundaryReminder" in value ? value["taskBoundaryReminder"] : 0;
	return {
		active: "all",
		modelWhitelist: [...DEFAULT_MODEL_WHITELIST],
		normalCompaction: value["continuity"] === "notes-and-compaction",
		rankedHistorySearch: false,
		noteSaveMarkers: preferences.noteSaveMarkers,
		shareSubagentContext:
			"shareSubagentContext" in value && value["shareSubagentContext"] === true,
		newWindowRequests: NEW_WINDOW_REQUESTS.some((item) => item === requests)
			? (requests as NewWindowRequests)
			: "unrestricted",
		taskCompletionRollover: false,
		rolloverTail: "off",
		idleMinutes: [...IDLE_MINUTES, 5, 15].some((item) => item === idle)
			? (idle as IdleMinutes)
			: 0,
		taskBoundaryReminder:
			typeof reminder === "number" &&
			Number.isSafeInteger(reminder) &&
			reminder >= 0
				? reminder
				: 0,
	};
}

function parseRolloverTail(value: unknown): RolloverTailMode | undefined {
	return ROLLOVER_TAILS.find((mode) => mode === value);
}

/** Global first, then the trusted project's explicitly configured values. */
function readLegacyPreferences(paths: readonly string[]): {
	compaction: Record<string, unknown>;
	noteSaveMarkers: boolean;
} {
	const compaction: Record<string, unknown> = {};
	let noteSaveMarkers = false;
	for (const path of paths) {
		let document: unknown;
		try {
			document = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		if (!document || typeof document !== "object" || Array.isArray(document))
			continue;
		if (
			"compaction" in document &&
			document.compaction &&
			typeof document.compaction === "object" &&
			!Array.isArray(document.compaction)
		) {
			// Old PCC releases migrated these axes in memory only. Translate each
			// scope before layering so project opt-outs and current fields win.
			const value = document.compaction as Record<string, unknown>;
			const mode = value["contextManagement"];
			const modeOverride =
				mode === "off" ||
				mode === "local" ||
				mode === "tree" ||
				mode === "remote";
			const inheritedNotes =
				compaction["continuity"] === "notes" ||
				compaction["continuity"] === "notes-and-compaction";
			const notes = modeOverride ? mode !== "off" : inheritedNotes;
			const hybrid =
				typeof value["hybridCompaction"] === "boolean"
					? value["hybridCompaction"]
					: compaction["continuity"] === "notes-and-compaction";
			if (
				modeOverride ||
				(notes && typeof value["hybridCompaction"] === "boolean")
			)
				compaction["continuity"] = notes
					? hybrid
						? "notes-and-compaction"
						: "notes"
					: "compaction";
			Object.assign(compaction, document.compaction);
		}
		for (const key of ["display", "ui"]) {
			const section = (document as Record<string, unknown>)[key];
			if (
				section &&
				typeof section === "object" &&
				"noteSaveMarkers" in section
			) {
				noteSaveMarkers = section.noteSaveMarkers === true;
				break;
			}
		}
	}
	return { compaction, noteSaveMarkers };
}
