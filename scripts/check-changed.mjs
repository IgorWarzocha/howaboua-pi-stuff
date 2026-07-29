#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const base = process.env.CHANGED_BASE || process.argv[2] || "origin/main";
const changedJson = spawnSync("bun", ["run", "scripts/changed-workspaces.mjs", base], { encoding: "utf8" });
const packages = JSON.parse(changedJson.stdout || "[]");
if (packages.length === 0) {
  console.log("No changed workspace packages.");
  process.exit(0);
}
let failed = false;
for (const dir of packages) {
  const cwd = join(process.cwd(), "packages", dir);
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  if (pkg.scripts?.check) {
    console.log(`\n==> ${pkg.name}: check`);
    const result = spawnSync("bun", ["run", "check"], { cwd, stdio: "inherit" });
    if (result.status !== 0) failed = true;
  }
  if (pkg.scripts?.build && Array.isArray(pkg.pi?.extensions)) {
    console.log(`\n==> ${pkg.name}: extension artifact`);
    const result = spawnSync(
      "node",
      ["scripts/verify-pi-extension-artifact.mjs", join("packages", dir)],
      { stdio: "inherit" },
    );
    if (result.status !== 0) failed = true;
  }
}
console.log("\n==> changed workspaces: knip");
const knip = spawnSync("bun", ["run", "knip"], { stdio: "inherit" });
if (knip.status !== 0) failed = true;
process.exit(failed ? 1 : 0);
