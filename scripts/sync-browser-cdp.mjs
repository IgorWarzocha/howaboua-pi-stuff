#!/usr/bin/env node
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
	root,
	"packages/pi-skill-chrome-cdp/skills/chrome-cdp/scripts/cdp-lib",
);
const target = resolve(
	root,
	"packages/pi-codex-conversion/examples/custom-tools/browser/cdp-lib",
);
const mode = process.argv[2];

if (mode === "--write") {
	rmSync(target, { force: true, recursive: true });
	cpSync(source, target, { recursive: true });
	console.log(`Synced browser CDP modules to ${relative(root, target)}`);
} else if (mode === "--check") {
	const sourceFiles = files(source);
	const targetFiles = files(target);
	if (
		JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles) ||
		sourceFiles.some(
			(file) =>
				!readFileSync(resolve(source, file)).equals(
					readFileSync(resolve(target, file)),
				),
		)
	) {
		throw new Error(
			"Browser CDP module copies drifted; edit the pi-skill-chrome-cdp cdp-lib source and run bun browser-cdp:sync",
		);
	}
	console.log("Browser CDP module copies are synchronized");
} else {
	throw new Error("Usage: sync-browser-cdp.mjs --write|--check");
}

function files(directory, prefix = "") {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			return entry.isDirectory()
				? files(resolve(directory, entry.name), path)
				: [path];
		})
		.sort();
}
