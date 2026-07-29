#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const packageDirs = listActivePackageDirs(root);

for (const dir of packageDirs) {
	const changelogPath = join(root, "packages", dir, "CHANGELOG.md");
	if (!existsSync(changelogPath)) continue;
	const before = readFileSync(changelogPath, "utf8");
	const after = before
		.replace(/^### Major Changes$/gm, "### Breaking changes")
		.replace(/^### Minor Changes$/gm, "### Changes")
		.replace(/^### Patch Changes$/gm, "### Changes");
	if (after !== before) writeFileSync(changelogPath, after);
}

console.log("Polished package changelog headings.");
