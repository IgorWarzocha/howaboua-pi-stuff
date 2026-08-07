import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export function resolveNotebookProject(cwd: string): string {
	let current = resolve(cwd);
	const root = parse(current).root;
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		if (current === root) return resolve(cwd);
		current = dirname(current);
	}
}
