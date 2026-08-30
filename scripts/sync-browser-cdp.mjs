#!/usr/bin/env node
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cdpSource = resolve(
	root,
	"packages/pi-skill-chrome-cdp/skills/chrome-cdp/scripts/cdp-lib",
);
const cdpTargets = [
	resolve(root, "packages/pi-browser/browser/cdp-lib"),
	resolve(root, "packages/pi-codex-conversion/examples/custom-tools/browser/cdp-lib"),
];
const browserSource = resolve(root, "packages/pi-browser/browser");
const browserTarget = resolve(
	root,
	"packages/pi-codex-conversion/examples/custom-tools/browser",
);
const browserFiles = ["browser.mjs", "cdp.mjs", "launcher.mjs"];
const mode = process.argv[2];

if (mode === "--write") {
	for (const target of cdpTargets) {
		rmSync(target, { force: true, recursive: true });
		cpSync(cdpSource, target, { recursive: true });
	}
	for (const file of browserFiles) {
		cpSync(resolve(browserSource, file), resolve(browserTarget, file));
	}
	console.log(
		`Synced browser runtime to ${[
			...cdpTargets,
			browserTarget,
		].map((target) => relative(root, target)).join(", ")}`,
	);
} else if (mode === "--check") {
	const cdpDrift = cdpTargets.some(
		(target) => !directoriesMatch(cdpSource, target),
	);
	const browserDrift = browserFiles.some(
		(file) =>
			!readFileSync(resolve(browserSource, file)).equals(
				readFileSync(resolve(browserTarget, file)),
			),
	);
	if (cdpDrift || browserDrift) {
		throw new Error(
			"Browser runtime copies drifted; edit pi-browser/browser or the pi-skill-chrome-cdp cdp-lib source, then run bun browser-cdp:sync",
		);
	}
	console.log("Browser runtime copies are synchronized");
} else {
	throw new Error("Usage: sync-browser-cdp.mjs --write|--check");
}

function directoriesMatch(source, target) {
	const sourceFiles = files(source);
	const targetFiles = files(target);
	return (
		JSON.stringify(sourceFiles) === JSON.stringify(targetFiles) &&
		sourceFiles.every((file) =>
			readFileSync(resolve(source, file)).equals(
				readFileSync(resolve(target, file)),
			),
		)
	);
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
