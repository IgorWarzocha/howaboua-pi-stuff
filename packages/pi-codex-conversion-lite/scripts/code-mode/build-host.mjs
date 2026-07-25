#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = join(root, "code-mode", "vendor", "code-mode-src");
const binaryName =
	process.platform === "win32"
		? "codex-code-mode-host.exe"
		: "codex-code-mode-host";
const built = join(source, "target", "release", binaryName);
const outDir = join(root, "code-mode", "bin", `${process.platform}-${process.arch}`);
const result = spawnSync(
	"cargo",
	["build", "--release", "-p", "codex-code-mode-host"],
	{ cwd: source, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(built)) throw new Error(`Expected ${built}`);
mkdirSync(outDir, { recursive: true });
const destination = join(outDir, binaryName);
copyFileSync(built, destination);
if (process.platform !== "win32") chmodSync(destination, 0o755);
console.log(`Wrote ${destination}`);
