#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const changesetDir = join(root, ".changeset");
const packagesDir = join(root, "packages");
const aggregateNames = new Set([
	"@howaboua/pi-stuff",
	"@howaboua/pi-extensions",
	"@howaboua/pi-skills",
]);
const aggregateExcludedNames = new Set([
	"@howaboua/pi-codex-conversion",
	"@howaboua/pi-skill-omarchy-help",
	"@howaboua/pi-subdir-agents",
]);
const generatedFiles = [
	"aggregate-bundles.md",
	"aggregate-stuff.md",
	"aggregate-extensions.md",
	"aggregate-skills.md",
];
const removalBase = process.env.AGGREGATE_BASE ?? "HEAD~1";

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function retiredPackageChanges() {
	const diff = spawnSync(
		"git",
		["diff", "--name-status", "--diff-filter=D", removalBase, "--", "packages"],
		{ cwd: root, encoding: "utf8" },
	);
	if (diff.status !== 0) return [];

	return diff.stdout
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			const path = line.slice(2);
			if (!/^packages\/[^/]+\/package\.json$/.test(path)) return [];
			const previous = spawnSync("git", ["show", `${removalBase}:${path}`], {
				cwd: root,
				encoding: "utf8",
			});
			if (previous.status !== 0) return [];
			const pkg = JSON.parse(previous.stdout);
			if (aggregateExcludedNames.has(pkg.name)) return [];
			return [
				...(Array.isArray(pkg.pi?.extensions) && pkg.pi.extensions.length > 0
					? [{
							name: pkg.name,
							body: "Remove retired bundled extension",
							kind: "extension",
						}]
					: []),
				...(Array.isArray(pkg.pi?.skills) && pkg.pi.skills.length > 0
					? [{
							name: pkg.name,
							body: "Remove retired bundled skill",
							kind: "skill",
						}]
					: []),
			];
		});
}

function parseChangeset(text) {
	const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { packages: [], body: "" };
	const packages = [
		...match[1].matchAll(/^["']?([^'":\n]+)["']?:\s*(patch|minor|major)$/gm),
	].map((m) => m[1].trim());
	return { packages, body: match[2].trim() };
}

function cleanBody(body) {
	return body
		.replace(/^#+\s+/gm, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\.$/, "");
}

function writeAggregateChangeset(filename, packages, includedChanges) {
	const frontmatter = packages.map((name) => `"${name}": patch`).join("\n");
	const bullets = includedChanges
		.map(
			({ name, body }) =>
				`- ${name}: ${cleanBody(body) || "Updated bundled package"}.`,
		)
		.join("\n");
	const content = `---\n${frontmatter}\n---\n\nInclude bundled package updates:\n\n${bullets}\n`;
	writeFileSync(join(changesetDir, filename), content);
	console.log(`Wrote ${filename} for ${packages.join(", ")}.`);
}

if (!existsSync(changesetDir)) process.exit(0);

for (const file of generatedFiles) {
	const path = join(changesetDir, file);
	if (existsSync(path)) rmSync(path);
}

const changesByPackage = new Map();
for (const file of readdirSync(changesetDir).sort()) {
	if (
		!file.endsWith(".md") ||
		file === "README.md" ||
		generatedFiles.includes(file)
	)
		continue;
	const text = readFileSync(join(changesetDir, file), "utf8");
	const changeset = parseChangeset(text);
	for (const pkg of changeset.packages) {
		const bodies = changesByPackage.get(pkg) ?? [];
		if (!bodies.includes(changeset.body)) bodies.push(changeset.body);
		changesByPackage.set(pkg, bodies);
	}
}

const packageInfos = listActivePackageDirs(root).map((dir) => ({
	dir,
	pkg: readJson(join(packagesDir, dir, "package.json")),
}));

const changedExtensions = [];
const changedSkills = [];

for (const { pkg } of packageInfos) {
	if (
		!changesByPackage.has(pkg.name) ||
		aggregateNames.has(pkg.name) ||
		aggregateExcludedNames.has(pkg.name)
	)
		continue;
	const hasExtensions =
		Array.isArray(pkg.pi?.extensions) && pkg.pi.extensions.length > 0;
	const hasSkills = Array.isArray(pkg.pi?.skills) && pkg.pi.skills.length > 0;
	for (const body of changesByPackage.get(pkg.name) ?? []) {
		const entry = { name: pkg.name, body };
		if (hasExtensions) changedExtensions.push(entry);
		if (hasSkills) changedSkills.push(entry);
	}
}

for (const retired of retiredPackageChanges()) {
	if (retired.kind === "extension") changedExtensions.push(retired);
	else changedSkills.push(retired);
}

const changedStuff = [...changedExtensions, ...changedSkills];
let wrote = false;
if (changedStuff.length > 0 && !changesByPackage.has("@howaboua/pi-stuff")) {
	writeAggregateChangeset(
		"aggregate-stuff.md",
		["@howaboua/pi-stuff"],
		changedStuff,
	);
	wrote = true;
}
if (
	changedExtensions.length > 0 &&
	!changesByPackage.has("@howaboua/pi-extensions")
) {
	writeAggregateChangeset(
		"aggregate-extensions.md",
		["@howaboua/pi-extensions"],
		changedExtensions,
	);
	wrote = true;
}
if (changedSkills.length > 0 && !changesByPackage.has("@howaboua/pi-skills")) {
	writeAggregateChangeset(
		"aggregate-skills.md",
		["@howaboua/pi-skills"],
		changedSkills,
	);
	wrote = true;
}

if (!wrote) console.log("No aggregate package changeset needed.");
