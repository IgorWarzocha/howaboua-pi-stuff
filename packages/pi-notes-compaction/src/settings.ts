import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const IDLE_MINUTES = [0, 5, 15, 25, 55] as const;
export type IdleMinutes = (typeof IDLE_MINUTES)[number];
export interface NotesSettings {
	normalCompaction: boolean;
	idleMinutes: IdleMinutes;
}

export function readSettings(path: string): NotesSettings {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { normalCompaction: false, idleMinutes: 0 };
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
			"Invalid notes settings. Use /notes compact on or /notes compact off to replace them.",
		);
	const idleMinutes = "idleMinutes" in settings ? settings.idleMinutes : 0;
	if (!IDLE_MINUTES.some((value) => value === idleMinutes))
		throw new Error(
			"Invalid idle rollover interval. Choose off, 5, 15, 25 or 55 minutes.",
		);
	return {
		normalCompaction: settings.normalCompaction,
		idleMinutes: idleMinutes as IdleMinutes,
	};
}

export function writeSettings(path: string, settings: NotesSettings): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporary, path);
}
