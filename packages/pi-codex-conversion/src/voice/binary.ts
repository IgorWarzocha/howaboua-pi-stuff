import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM_DIR = `${process.platform}-${process.arch}`;
const EXECUTABLE = process.platform === "win32" ? "pi-codex-voice.exe" : "pi-codex-voice";

export function resolveVoiceHelperBinary(): string | undefined {
	const sourceRoot = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(sourceRoot, "bin", PLATFORM_DIR, EXECUTABLE),
		join(sourceRoot, "rust", "target", "release", EXECUTABLE),
		join(sourceRoot, "rust", "target", "debug", EXECUTABLE),
	];
	for (const candidate of candidates) {
		try {
			accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
			return candidate;
		} catch {}
	}
	return undefined;
}
