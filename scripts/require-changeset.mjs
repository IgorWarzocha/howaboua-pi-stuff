#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const base = process.env.CHANGED_BASE || process.argv[2] || "HEAD~1";
const aggregatePackageDirs = new Set([
	"pi-stuff",
	"pi-skills",
	"pi-extensions",
]);
const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
	cwd: root,
	encoding: "utf8",
	...(process.env.CHANGED_GIT_DIR
		? {
				env: {
					...process.env,
					GIT_DIR: process.env.CHANGED_GIT_DIR,
					GIT_WORK_TREE: root,
				},
			}
		: {}),
});
if (diff.status !== 0) {
	if (process.env.CHANGED_GIT_DIR) {
		process.stderr.write(
			diff.stderr || "Could not compare candidate Git metadata.\n",
		);
		process.exit(diff.status ?? 1);
	}
	process.exit(0);
}

const files = diff.stdout.split("\n").filter(Boolean);
const packageChanged = files.some((file) => {
	const dir = /^packages\/([^/]+)\//.exec(file)?.[1];
	if (!dir || aggregatePackageDirs.has(dir)) return false;
	const manifest = join(root, "packages", dir, "package.json");
	return (
		existsSync(manifest) &&
		JSON.parse(readFileSync(manifest, "utf8")).private !== true
	);
});
if (!packageChanged) process.exit(0);

const hasChangeset = files.some(
	(file) =>
		/^\.(?:changeset|changesets-pending)\/(?!README\.md$|aggregate-bundles\.md$)[^/]+\.md$/.test(
			file,
		) && existsSync(join(root, file)),
);
if (hasChangeset) process.exit(0);

console.error(
	"Package files changed, but no active or pending changeset was added or updated in this diff.",
);
console.error(
	"Run: bun changeset, or bun changeset -- --pending to defer publication.",
);
console.error(
	"If this is intentionally unreleased, bypass with: SKIP_CHANGESET_CHECK=1 git push",
);
process.exit(1);
