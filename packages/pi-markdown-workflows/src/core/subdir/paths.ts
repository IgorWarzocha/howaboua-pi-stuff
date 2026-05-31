import fs from "node:fs";
import path from "node:path";

import { normalizeAtPrefix } from "../workflow.js";

export function resolvePath(targetPath: string, baseDir: string): string {
	const cleaned = normalizeAtPrefix(targetPath);
	const absolute = path.isAbsolute(cleaned)
		? path.normalize(cleaned)
		: path.resolve(baseDir, cleaned);
	try {
		return fs.realpathSync.native?.(absolute) ?? fs.realpathSync(absolute);
	} catch {
		return absolute;
	}
}

export function isInsideRoot(rootDir: string, targetPath: string): boolean {
	if (!rootDir) return false;
	const relative = path.relative(rootDir, targetPath);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

export function contentRootForTarget(targetPath: string): string {
	try {
		const startDir =
			fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
				? targetPath
				: path.dirname(targetPath);
		let dir = startDir;
		let best = "";
		while (true) {
			if (fs.existsSync(path.join(dir, "AGENTS.md"))) best = dir;
			if (fs.existsSync(path.join(dir, ".git"))) return dir;
			const parent = path.dirname(dir);
			if (parent === dir) return best || startDir;
			dir = parent;
		}
	} catch {
		return "";
	}
}
