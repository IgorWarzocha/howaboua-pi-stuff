import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const COMMS_SETTINGS_FILE = "pi-agent-comms.json";

export function commsSettingsPath(): string {
	return settingsPath(getAgentDir(), COMMS_SETTINGS_FILE);
}

export function settingsPath(directory: string, filename: string): string {
	const path = join(directory, filename);
	try {
		return realpathSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return path;
		throw error;
	}
}

export function isSettingsObject(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readSettingsFile(
	path: string,
): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isSettingsObject(value))
			throw new Error("configuration must be an object");
		return value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw new Error(`Could not read ${path}: ${String(error)}`, {
			cause: error,
		});
	}
}

export function writeSettingsFile(
	path: string,
	document: Record<string, unknown>,
): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
