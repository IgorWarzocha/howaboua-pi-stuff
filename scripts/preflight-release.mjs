#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const candidates = [];
for (const dir of listActivePackageDirs(root)) {
	const cwd = join(root, "packages", dir);
	const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
	if (pkg.private) continue;
	if (typeof pkg.name !== "string" || typeof pkg.version !== "string") throw new Error(`Invalid package metadata: ${dir}`);
	const scope = pkg.name.startsWith("@") ? pkg.name.split("/")[0] : undefined;
	const scopedRegistry = scope && (pkg.publishConfig?.[`${scope}:registry`] || process.env[`npm_config_${scope}:registry`]);
	const registry = scopedRegistry || pkg.publishConfig?.registry || process.env.npm_config_registry;
	const args = ["view", pkg.name, "versions", "--json"];
	if (registry) args.push(`--${scopedRegistry ? `${scope}:` : ""}registry=${registry}`);
	const result = spawnSync("npm", args, { cwd, encoding: "utf8" });
	if (result.error) throw result.error;
	let metadata;
	try { metadata = JSON.parse(result.stdout); } catch { throw new Error(`Could not read npm metadata for ${pkg.name}: ${result.stderr || result.stdout}`); }
	if (result.status !== 0) {
		if (metadata?.error?.code !== "E404") throw new Error(`npm metadata failed for ${pkg.name}: ${result.stderr || result.stdout}`);
		candidates.push({ pkg, cwd });
		continue;
	}
	const versions = typeof metadata === "string" ? [metadata] : metadata;
	if (!Array.isArray(versions) || !versions.every((version) => typeof version === "string")) throw new Error(`Invalid npm versions for ${pkg.name}`);
	if (!versions.includes(pkg.version)) candidates.push({ pkg, cwd });
}

for (const { pkg, cwd } of candidates) {
	console.log(`\nPreflight ${pkg.name}@${pkg.version}`);
	const result = spawnSync("npm", ["pack", "--dry-run", "--foreground-scripts", "--ignore-scripts=false"], {
		cwd: pkg.publishConfig?.directory ? resolve(cwd, pkg.publishConfig.directory) : cwd,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
