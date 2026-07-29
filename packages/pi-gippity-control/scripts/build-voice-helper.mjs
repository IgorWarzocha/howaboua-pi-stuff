#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const sourceRoot = resolve("src/voice/rust");
const executable =
	process.platform === "win32" ? "pi-codex-voice.exe" : "pi-codex-voice";
const source = join(sourceRoot, "target", "release", executable);
const destinationDir = resolve(
	"src/voice/bin",
	`${process.platform}-${process.arch}`,
);
const result = spawnSync("cargo", ["build", "--release", "--locked"], {
	cwd: sourceRoot,
	stdio: "inherit",
	env: process.env,
});
if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(source)) throw new Error(`Expected voice helper at ${source}`);
mkdirSync(destinationDir, { recursive: true });
const destination = join(destinationDir, executable);
copyFileSync(source, destination);
if (process.platform !== "win32") chmodSync(destination, 0o755);
console.log(`Wrote ${destination}`);
