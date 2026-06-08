import { existsSync } from "node:fs";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const PATH_TOOL_WRAPPERS = [
	process.platform === "win32" ? "apply_patch.cmd" : "apply_patch",
	"view_image",
	"web_run",
	"imagegen",
];

export function getBundledPathToolsBinDir(): string {
	return join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "bin");
}

export function ensureBundledPathToolsOnPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const binDir = getBundledPathToolsBinDir();
	if (!PATH_TOOL_WRAPPERS.some((wrapper) => existsSync(join(binDir, wrapper)))) {
		return undefined;
	}
	const currentPath = env["PATH"] ?? "";
	const entries = currentPath.split(delimiter).filter(Boolean);
	if (!entries.includes(binDir)) {
		env["PATH"] = [binDir, ...entries].join(delimiter);
	}
	return binDir;
}
