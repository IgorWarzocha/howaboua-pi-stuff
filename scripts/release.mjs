#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.length === 1 && args[0] === "--dry-run";
if (args.length && !dryRun)
	throw new Error("Usage: bun run release [--dry-run]");

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`${command} ${args[0]} failed (${result.signal ?? result.status})`,
		);
}

const staging = mkdtempSync(join(tmpdir(), "pi-stuff-release-"));
try {
	const planFile = join(staging, "plan.json");
	run("changeset", ["publish-plan", "--output", planFile]);
	const { version, plan } = JSON.parse(readFileSync(planFile, "utf8"));
	if (version !== 1 || !Array.isArray(plan))
		throw new Error("Unsupported Changesets publish plan");
	const packages = new Map(
		listActivePackageDirs(root).map((dir) => {
			const cwd = join(root, "packages", dir);
			const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
			return [pkg.name, { pkg, cwd }];
		}),
	);

	// Run all npm publish hooks serially. Workspace checks read other packages' dist.
	for (const release of plan.flat()) {
		if (release.kind === "tag-only") continue;
		const target = packages.get(release.name);
		if (
			release.kind !== "publish" ||
			!target ||
			target.pkg.private ||
			target.pkg.version !== release.version
		)
			throw new Error(
				`Unknown release target: ${release.name}@${release.version}`,
			);
		const { pkg, cwd } = target;
		console.log(`\nPreflight ${pkg.name}@${pkg.version}`);
		run(
			"npm",
			[
				"publish",
				"--dry-run",
				"--foreground-scripts",
				"--ignore-scripts=false",
				"--access",
				release.access,
				"--tag",
				release.tag,
			],
			{ cwd: resolve(cwd, pkg.publishConfig?.directory ?? ".") },
		);
	}

	// Freeze the prepared outputs. No build or package checks during parallel uploads.
	const packDir = join(staging, "packed");
	run(
		"changeset",
		["pack", "--from-publish-plan", planFile, "--out-dir", packDir],
		{ env: { ...process.env, npm_config_ignore_scripts: "true" } },
	);
	if (!dryRun) run("changeset", ["publish", "--from-pack-dir", packDir]);
} finally {
	rmSync(staging, { recursive: true, force: true });
}
