#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listActivePackageDirs } from "./active-packages.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
	console.log("Usage: node scripts/prepare-preview-release.mjs [--write]\nPlan a dev/<package>/<commit> or core/<package>/<commit> tag release using GitHub Actions run metadata. --write changes only the selected package's version and emits step outputs.");
	process.exit(0);
}
if (args.some((arg) => arg !== "--write")) throw new Error("Use --help for preview release arguments");
const root = process.cwd();
const match = /^refs\/tags\/(dev|core)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{7,40})$/.exec(process.env.GITHUB_REF ?? "");
if (!match) throw new Error("Preview releases require a dev/<package>/<commit> or core/<package>/<commit> Git tag");
const [, tag, packageDir, revision] = match;
if (!listActivePackageDirs(root).includes(packageDir)) throw new Error(`Unknown package: ${packageDir}`);
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (process.env.GITHUB_SHA !== sha || !sha.startsWith(revision)) throw new Error("Preview tag must identify the checked-out commit");
for (const field of ["GITHUB_RUN_NUMBER", "GITHUB_RUN_ATTEMPT"]) {
	if (!/^[1-9][0-9]*$/.test(process.env[field] ?? "")) throw new Error(`Missing or invalid ${field}`);
}
const directory = `packages/${packageDir}`;
const manifest = join(root, directory, "package.json");
const pkg = JSON.parse(readFileSync(manifest, "utf8"));
if (pkg.private || pkg.name !== `@howaboua/${packageDir}`) throw new Error("Preview target must be a public package in this repository");
if (["pi-stuff", "pi-extensions", "pi-skills"].includes(packageDir)) throw new Error("Publish previews of individual packages, not aggregate bundles");
if (pkg.publishConfig?.directory) throw new Error("Preview publishing requires the package's own manifest, not a publish directory override");
const base = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(pkg.version ?? "");
if (!base) throw new Error("Preview releases require a stable source version");
const patch = Number(base[3]) + 1;
if (!Number.isSafeInteger(patch)) throw new Error("Invalid source patch version");
const version = `${base[1]}.${base[2]}.${patch}-${tag}.${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT}.g${sha.slice(0, 12)}`;
const plan = { directory, name: pkg.name, version, tag };
if (args.includes("--write")) {
	if (!process.env.GITHUB_OUTPUT) throw new Error("Writing a preview version requires GITHUB_OUTPUT");
	writeFileSync(manifest, `${JSON.stringify({ ...pkg, version }, null, "\t")}\n`);
	appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(""));
}
console.log(JSON.stringify(plan, null, 2));
