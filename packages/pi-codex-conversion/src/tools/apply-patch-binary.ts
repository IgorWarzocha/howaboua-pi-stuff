import { existsSync } from "node:fs";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export function getBundledApplyPatchBinDir(): string {
	return join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "bin");
}

export function ensureBundledApplyPatchOnPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const binDir = getBundledApplyPatchBinDir();
	const wrapperPath = join(binDir, process.platform === "win32" ? "apply_patch.cmd" : "apply_patch");
	if (!existsSync(wrapperPath)) {
		return undefined;
	}
	const currentPath = env["PATH"] ?? "";
	const entries = currentPath.split(delimiter).filter(Boolean);
	if (!entries.includes(binDir)) {
		env["PATH"] = [binDir, ...entries].join(delimiter);
	}
	return binDir;
}
