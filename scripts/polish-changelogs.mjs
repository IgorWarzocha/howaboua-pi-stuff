#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const packageDirs = listActivePackageDirs(root);
const aggregateDirs = new Set(["pi-stuff", "pi-skills", "pi-extensions"]);

function removeDependencyBlocks(markdown, dependencyOnlyCopy) {
	return markdown
		.split(/(?=^## )/m)
		.map((section) => {
			if (!section.startsWith("## ")) return section;
			let found = false;
			const withoutDependencies = section.replace(
				/^- Updated dependencies[^\n]*:\n(?: {2,}- [^\n]+\n?)+/gm,
				() => {
					found = true;
					return "";
				},
			);
			if (!found) return section;
			const releaseCopy = withoutDependencies
				.replace(/^##[^\n]*\n?/, "")
				.replace(/^###[^\n]*\n?/gm, "")
				.trim();
			if (releaseCopy.length > 0)
				return withoutDependencies.replace(/\n{3,}/g, "\n\n");
			const heading = section.match(/^##[^\n]*/)?.[0];
			return heading ? `${heading}\n\n- ${dependencyOnlyCopy}\n` : section;
		})
		.join("");
}

for (const dir of packageDirs) {
	const changelogPath = join(root, "packages", dir, "CHANGELOG.md");
	if (!existsSync(changelogPath)) continue;
	const before = readFileSync(changelogPath, "utf8");
	const headingsPolished = before
		.replace(/^### Major Changes$/gm, "### Breaking changes")
		.replace(/^### (?:Minor|Patch) Changes\s*\n/gm, "");
	const after = removeDependencyBlocks(
		headingsPolished,
		aggregateDirs.has(dir)
			? "Updated bundled packages."
			: "Updated package dependencies.",
	);
	if (after !== before) writeFileSync(changelogPath, after);
}

console.log("Polished package changelog headings.");
