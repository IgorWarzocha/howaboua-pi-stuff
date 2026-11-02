#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { changesetText, readPendingChangesets } from "./pending-changesets.mjs";

const root = process.cwd();
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const defer = args[0] === "--pending";
if (defer) args.shift();
const base = process.env.CHANGED_BASE || "origin/main";
const aggregatePackages = new Set([
	"@howaboua/pi-extensions",
	"@howaboua/pi-skills",
	"@howaboua/pi-stuff",
]);

const diff = spawnSync(
	"git",
	[
		"diff",
		"--name-only",
		base,
		"--",
		"packages",
		".changeset",
		".changesets-pending",
	],
	{
		cwd: root,
		encoding: "utf8",
	},
);
if (diff.status !== 0) {
	process.stderr.write(
		diff.stderr || `Could not compare changed packages with ${base}\n`,
	);
	process.exit(diff.status ?? 1);
}

const untracked = spawnSync(
	"git",
	[
		"ls-files",
		"--others",
		"--exclude-standard",
		"--",
		".changeset",
		".changesets-pending",
	],
	{
		cwd: root,
		encoding: "utf8",
	},
);
if (untracked.status !== 0) {
	process.stderr.write(
		untracked.stderr || "Could not inspect new changesets.\n",
	);
	process.exit(untracked.status ?? 1);
}
const changedFiles = new Set(`${diff.stdout}\n${untracked.stdout}`.split("\n"));

const packageDirs = new Set(
	diff.stdout
		.split("\n")
		.map((path) => /^packages\/([^/]+)\//.exec(path)?.[1])
		.filter(Boolean),
);
const changedPackages = [...packageDirs]
	.map((dir) => {
		const path = join(root, "packages", dir, "package.json");
		return existsSync(path)
			? JSON.parse(readFileSync(path, "utf8"))
			: undefined;
	})
	.filter(
		(pkg) =>
			pkg?.name && pkg.private !== true && !aggregatePackages.has(pkg.name),
	)
	.map((pkg) => pkg.name)
	.sort();

const changesetDir = join(root, ".changeset");
const active = readdirSync(changesetDir)
	.filter(
		(name) =>
			name.endsWith(".md") &&
			name !== "README.md" &&
			changedFiles.has(`.changeset/${name}`),
	)
	.map((name) => readFileSync(join(changesetDir, name), "utf8"))
	.join("\n");
const pending = readPendingChangesets(root);
const pendingNames = new Set(
	pending
		.filter(({ path }) => changedFiles.has(relative(root, path)))
		.map(({ name }) => name),
);
const packages = changedPackages.filter(
	(name) => !active.includes(`"${name}":`) && !pendingNames.has(name),
);

if (packages.length === 0) {
	const detail =
		changedPackages.length > 0
			? "Changed packages already have active or pending changesets."
			: "No changed publishable packages.";
	console.log(detail);
	process.exit(0);
}

let summary = args.join(" ").trim();
if (!summary) {
	const readline = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
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

const destination = defer ? ".changesets-pending" : ".changeset";
mkdirSync(join(root, destination), { recursive: true });
for (const name of packages) {
	const existing = defer
		? pending.find((note) => note.name === name)
		: undefined;
	if (existing) {
		writeFileSync(
			existing.path,
			changesetText(
				[{ name, type: existing.type }],
				`${existing.summary}\n\n${summary}`,
			),
		);
		console.log(
			`Updated pending changeset for ${name}: ${relative(root, existing.path)}`,
		);
		continue;
	}
	const file = `patch-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}.md`;
	writeFileSync(
		join(root, destination, file),
		changesetText([{ name, type: "patch" }], summary),
	);
	console.log(`Added patch changeset for ${name}: ${destination}/${file}`);
}
