#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { isActivePackageDir } from "./active-packages.mjs";

const root = process.cwd();
const base = process.env.CHANGED_BASE || "origin/main";
const aggregatePackages = new Set([
	"@howaboua/pi-extensions",
	"@howaboua/pi-skills",
	"@howaboua/pi-stuff",
]);

const diff = spawnSync("git", ["diff", "--name-only", base, "--", "packages"], {
	cwd: root,
	encoding: "utf8",
});
if (diff.status !== 0) {
	process.stderr.write(diff.stderr || `Could not compare changed packages with ${base}\n`);
	process.exit(diff.status ?? 1);
}

const packageDirs = new Set(
	diff.stdout
		.split("\n")
		.map((path) => /^packages\/([^/]+)\//.exec(path)?.[1])
		.filter((dir) => dir && isActivePackageDir(dir)),
);
const changedPackages = [...packageDirs]
	.map((dir) => {
		const path = join(root, "packages", dir, "package.json");
		return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
	})
	.filter((pkg) => pkg?.name && pkg.private !== true && !aggregatePackages.has(pkg.name))
	.map((pkg) => pkg.name)
	.sort();

const changesetDir = join(root, ".changeset");
const pending = readdirSync(changesetDir)
	.filter((name) => name.endsWith(".md") && name !== "README.md")
	.map((name) => readFileSync(join(changesetDir, name), "utf8"))
	.join("\n");
const packages = changedPackages.filter((name) => !pending.includes(`"${name}":`));

if (packages.length === 0) {
	const detail = changedPackages.length > 0 ? "Changed packages already have changesets." : "No changed publishable packages."
	console.log(detail);
	process.exit(0);
}

let summary = process.argv.slice(2).join(" ").trim();
if (!summary) {
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		summary = (await readline.question("Summary: ")).trim();
	} finally {
		readline.close();
	}
}
if (!summary) {
	console.error("Changeset summary is required.");
	process.exit(1);
}

const name = `patch-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}.md`;
const frontmatter = packages.map((name) => `"${name}": patch`).join("\n");
writeFileSync(join(changesetDir, name), `---\n${frontmatter}\n---\n\n${summary}\n`);
console.log(`Added patch changeset for ${packages.join(", ")}: .changeset/${name}`);
