#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const checks = [
  ["cargo", ["fmt", "--check"]],
  ["cargo", ["clippy", "--locked", "--all-targets", "--", "-D", "warnings"]],
  [process.execPath, [join(root, "../../node_modules/@typescript/native-preview/bin/tsgo"), "-p", "tsconfig.json"]],
  ...["build.mjs", "check.mjs", "machine-settings.cjs", ...readdirSync(join(root, "mod")).filter(file => file.endsWith(".js")).map(file => "mod/" + file)]
    .map((file) => [process.execPath, ["--check", file]]),
];
for (const [command, args] of checks) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
