#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const base = process.env.CHANGED_BASE || process.argv[2] || "origin/main";
// Scope candidate metadata to this comparison so temporary test repos stay isolated.
const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  cwd: root,
  encoding: "utf8",
  ...(process.env.CHANGED_GIT_DIR ? {
    env: { ...process.env, GIT_DIR: process.env.CHANGED_GIT_DIR, GIT_WORK_TREE: root },
  } : {}),
});
if (diff.status !== 0) {
  if (process.env.CHANGED_GIT_DIR) {
    process.stderr.write(diff.stderr || "Could not compare candidate Git metadata.\n");
    process.exit(diff.status ?? 1);
  }
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
