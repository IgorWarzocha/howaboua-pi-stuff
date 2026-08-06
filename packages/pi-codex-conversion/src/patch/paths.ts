import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DiffError } from "./types.ts";

export function normalizePatchPath({ path }: { path: string }): string {
	const trimmed = path.trim();
	const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	return withoutAt.replace(/^['"]|['"]$/g, "");
}

// Match Codex apply_patch path handling: absolute patch paths are accepted
// as-is, while relative paths are resolved against ctx.cwd.
export function resolvePatchPath({ cwd, patchPath }: { cwd: string; patchPath: string }): string {
	const normalized = normalizePatchPath({ path: patchPath });
	if (!normalized) {
		throw new DiffError("Patch path cannot be empty");
	}

	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

export function openFileAtPath({ cwd, path }: { cwd: string; path: string }): string {
	const absolutePath = resolvePatchPath({ cwd, patchPath: path });
	if (!existsSync(absolutePath)) {
		throw new DiffError(`File not found: ${path}`);
	}
	return readFileSync(absolutePath, "utf8");
}
