import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DiffError } from "./types.js";
export function normalizePatchPath({ path }) {
    const trimmed = path.trim();
    const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    return withoutAt.replace(/^['"]|['"]$/g, "");
}
// Match Codex apply_patch path handling: absolute patch paths are accepted
// as-is, while relative paths are resolved against ctx.cwd.
export function resolvePatchPath({ cwd, patchPath }) {
    const normalized = normalizePatchPath({ path: patchPath });
    if (!normalized) {
        throw new DiffError("Patch path cannot be empty");
    }
    return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}
export function openFileAtPath({ cwd, path }) {
    const absolutePath = resolvePatchPath({ cwd, patchPath: path });
    if (!existsSync(absolutePath)) {
        throw new DiffError(`File not found: ${path}`);
    }
    return readFileSync(absolutePath, "utf8");
}
export function writeFileAtPath({ cwd, path, content }) {
    const absolutePath = resolvePatchPath({ cwd, patchPath: path });
    const created = !existsSync(absolutePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
    return { created };
}
export function removeFileAtPath({ cwd, path }) {
    const absolutePath = resolvePatchPath({ cwd, patchPath: path });
    if (!existsSync(absolutePath)) {
        throw new DiffError(`File not found: ${path}`);
    }
    unlinkSync(absolutePath);
}
export function pathExists({ cwd, path }) {
    return existsSync(resolvePatchPath({ cwd, patchPath: path }));
}
