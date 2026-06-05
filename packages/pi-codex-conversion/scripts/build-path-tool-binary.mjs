#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageName = process.argv[2] ?? "codex-view-image";
const binName = process.argv[3] ?? "view_image";
const sourceRoot = resolve(process.env.PATH_TOOLS_SOURCE_DIR ?? "vendor/path-tools-src");
const platform = process.platform;
const arch = process.arch;
const exe = platform === "win32" ? `${binName}.exe` : binName;
const outDir = resolve("vendor", "path-tools", `${platform}-${arch}`);
const source = join(sourceRoot, "target", "release", exe);

const cargo = spawnSync("cargo", ["build", "--release", "-p", packageName], {
	cwd: sourceRoot,
	stdio: "inherit",
	env: process.env,
});
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
