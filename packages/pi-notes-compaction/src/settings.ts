import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readNormalCompaction(path: string): boolean {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
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
	return settings.normalCompaction;
}

export function writeNormalCompaction(path: string, enabled: boolean): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(
		temporary,
		`${JSON.stringify({ normalCompaction: enabled }, null, 2)}\n`,
		{ mode: 0o600 },
	);
	renameSync(temporary, path);
}
