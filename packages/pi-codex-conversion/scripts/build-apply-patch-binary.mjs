#!/usr/bin/env node
import { copyFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const sourceRoot = resolve(process.env.APPLY_PATCH_SOURCE_DIR ?? process.argv[2] ?? "src/tools");
const platform = process.platform;
const arch = process.arch;
const exe = platform === "win32" ? "apply_patch.exe" : "apply_patch";
const outDir = resolve("src", "tools", "apply-patch", "bin", `${platform}-${arch}`);
const source = join(sourceRoot, "target", "release", exe);

const cargo = spawnSync("cargo", ["build", "--release", "-p", "codex-apply-patch"], { cwd: sourceRoot, stdio: "inherit", env: process.env });
if (cargo.status !== 0) process.exit(cargo.status ?? 1);
if (!existsSync(source)) {
	console.error(`Expected ${source} after cargo build`);
	process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, basename(source));
copyFileSync(source, dest);
if (platform !== "win32") chmodSync(dest, 0o755);
console.log(`Wrote ${dest}`);
