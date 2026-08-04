#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const base = process.env.CHANGED_BASE || process.argv[2] || "origin/main";
const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root, encoding: "utf8" });
if (diff.status !== 0) {
  // Fresh repo / no origin yet: return every package.
  const all = listActivePackageDirs(root);
  console.log(JSON.stringify(all));
  process.exit(0);
}
const files = diff.stdout.split("\n").filter(Boolean);
const changed = new Set();
for (const file of files) {
  const match = file.match(/^packages\/([^/]+)\//);
  if (match && existsSync(join(root, "packages", match[1], "package.json"))) changed.add(match[1]);
}
console.log(JSON.stringify([...changed].sort()));
