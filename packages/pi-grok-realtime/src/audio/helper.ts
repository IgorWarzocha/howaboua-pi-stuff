import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function audioHelperPath(): string {
	if (
		!["linux", "darwin", "win32"].includes(process.platform) ||
		!["x64", "arm64"].includes(process.arch)
	)
		throw new Error(
			`Local audio is not supported on ${process.platform}-${process.arch}`,
		);
	const path = fileURLToPath(
		new URL(
			`./bin/${process.platform}-${process.arch}/grok-audio${process.platform === "win32" ? ".exe" : ""}`,
			import.meta.url,
		),
	);
	if (!existsSync(path))
		throw new Error(
			`Audio helper missing for ${process.platform}-${process.arch}. Reinstall the package or build it with bun run build:audio-helper`,
		);
	return path;
}

/** Audio subprocesses receive platform session settings, never provider credentials. */
export function audioEnvironment(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of [
		"HOME",
		"USERPROFILE",
		"SystemRoot",
		"WINDIR",
		"TEMP",
		"TMP",
		"APPDATA",
		"LOCALAPPDATA",
		"XDG_RUNTIME_DIR",
		"PULSE_SERVER",
		"PULSE_COOKIE",
		"PULSE_SOURCE",
		"PULSE_SINK",
		"LANG",
	])
		if (process.env[key] !== undefined) env[key] = process.env[key];
	return env;
}
