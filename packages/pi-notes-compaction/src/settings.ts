import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const IDLE_MINUTES = [0, 5, 15, 25, 55] as const;
export type IdleMinutes = (typeof IDLE_MINUTES)[number];
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
	const idleMinutes = "idleMinutes" in settings ? settings.idleMinutes : 0;
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
	if (!IDLE_MINUTES.some((value) => value === idleMinutes))
		throw new Error(
			"Invalid idle rollover interval. Choose off, 5, 15, 25 or 55 minutes.",
		);
	return {
		active:
			"active" in settings
				? (settings.active as NotesSettings["active"])
				: "all",
		modelWhitelist:
			"modelWhitelist" in settings
				? (settings.modelWhitelist as string[])
				: [...DEFAULT_MODEL_WHITELIST],
		normalCompaction: settings.normalCompaction,
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
