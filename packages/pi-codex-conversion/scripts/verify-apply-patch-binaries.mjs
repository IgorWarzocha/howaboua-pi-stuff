#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";

const required = [
	["linux-x64", "apply_patch"],
	["linux-arm64", "apply_patch"],
	["darwin-x64", "apply_patch"],
	["darwin-arm64", "apply_patch"],
	["win32-x64", "apply_patch.exe"],
	["win32-arm64", "apply_patch.exe"],
];

const missing = required
	.map(([platformArch, exe]) => join("src", "tools", "apply-patch", "bin", platformArch, exe))
	.filter((path) => !existsSync(path));

if (missing.length > 0) {
	console.error("Refusing to publish: bundled apply_patch binaries are incomplete.");
	console.error("Missing:");
	for (const path of missing) console.error(`  - ${path}`);
	console.error("Run the GitHub Actions publish workflow so platform-native runners can build all binaries.");
	process.exit(1);
}

console.log("All bundled apply_patch binaries are present.");
