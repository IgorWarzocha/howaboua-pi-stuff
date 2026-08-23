import fs from "node:fs";
import path from "node:path";

import { isInsideRoot } from "./paths.js";

export function findAgentsFiles(
	filePath: string,
	rootDir: string,
	cwdAgentsPath: string,
): string[] {
	if (!rootDir) return [];
	const agentsFiles: string[] = [];
	let dir = path.dirname(filePath);
	while (isInsideRoot(rootDir, dir)) {
		const candidate = path.join(dir, "AGENTS.md");
		if (candidate !== cwdAgentsPath && fs.existsSync(candidate))
			agentsFiles.push(candidate);
		if (dir === rootDir) break;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return agentsFiles.reverse();
}
