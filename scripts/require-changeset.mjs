#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isActivePackageDir } from "./active-packages.mjs";

const root = process.cwd();
const base = process.env.CHANGED_BASE || process.argv[2] || "HEAD~1";
const aggregatePackageDirs = new Set(["pi-stuff", "pi-skills", "pi-extensions"]);
const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root, encoding: "utf8" });
if (diff.status !== 0) process.exit(0);

const files = diff.stdout.split("\n").filter(Boolean);
const packageChanged = files.some((file) => {
	const dir = /^packages\/([^/]+)\//.exec(file)?.[1];
	return dir && isActivePackageDir(dir) && !aggregatePackageDirs.has(dir);
});
if (!packageChanged) process.exit(0);

const changesetDir = join(root, ".changeset");
const hasChangeset = existsSync(changesetDir) && readdirSync(changesetDir).some((file) => file.endsWith(".md") && file !== "README.md" && file !== "aggregate-bundles.md");
if (hasChangeset) process.exit(0);

console.error("Package files changed, but no changeset was found.");
console.error("Run: bun changeset");
console.error("If this is intentionally unreleased, bypass with: SKIP_CHANGESET_CHECK=1 git push");
process.exit(1);
