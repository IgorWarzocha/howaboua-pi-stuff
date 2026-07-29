#!/usr/bin/env node
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { listActivePackageDirs } from "./active-packages.mjs";

const script = process.argv[2];
if (!script) {
  console.error("Usage: bun run scripts/workspaces.mjs <script>");
  process.exit(1);
}

const root = process.cwd();
const packagesDir = join(root, "packages");
const packages = listActivePackageDirs(root);
let failed = false;
for (const name of packages) {
  const cwd = join(packagesDir, name);
  const pkg = await import(join(cwd, "package.json"), { with: { type: "json" } }).then((m) => m.default);
  if (!pkg.scripts?.[script]) continue;
  console.log(`\n==> ${pkg.name ?? name}: ${script}`);
  const result = spawnSync("bun", ["run", script], { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
