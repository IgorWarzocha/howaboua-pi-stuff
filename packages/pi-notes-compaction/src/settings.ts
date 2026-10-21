import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Hour presets store their effective duration, with five minutes of headroom.
export const IDLE_MINUTES = [0, 25, 55, 115, 355, 715] as const;
export type IdleMinutes = (typeof IDLE_MINUTES)[number] | 5 | 15;
export const NEW_WINDOW_REQUESTS = [
	"off",
	"pi-limits",
	"unrestricted",
] as const;
export type NewWindowRequests = (typeof NEW_WINDOW_REQUESTS)[number];
export const DEFAULT_MODEL_WHITELIST = [
	"gpt-6-astra",
	"gpt-6-sol",
	"gpt-6-luna",
	"gpt-6.1-sol",
];
export interface NotesSettings {
	active: "all" | "whitelist";
	modelWhitelist: string[];
	normalCompaction: boolean;
	newWindowRequests: NewWindowRequests;
	idleMinutes: IdleMinutes;
	taskBoundaryReminder: number;
}

export function readSettings(path: string): NotesSettings {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return {
				active: "all",
				modelWhitelist: [...DEFAULT_MODEL_WHITELIST],
				normalCompaction: false,
				newWindowRequests: "unrestricted",
				idleMinutes: 0,
				taskBoundaryReminder: 0,
			};
		throw error;
	}
	const settings: unknown = JSON.parse(source);
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
	if (active !== "all" && active !== "whitelist")
		throw new Error(
			`Invalid active setting in ${path}. Use "all" or "whitelist", then reload Pi.`,
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
		newWindowRequests: newWindowRequests as NewWindowRequests,
		idleMinutes: idleMinutes as IdleMinutes,
		taskBoundaryReminder,
	};
}

export function modelIsActive(
	settings: NotesSettings,
	model?: { id: string },
): boolean {
	return (
		settings.active === "all" ||
		Boolean(model && settings.modelWhitelist.includes(model.id))
	);
}

export function writeSettings(path: string, settings: NotesSettings): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporary, path);
}
