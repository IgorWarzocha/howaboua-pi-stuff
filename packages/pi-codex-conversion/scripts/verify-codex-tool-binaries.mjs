#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";

const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64"];
const tools = [
	{ dir: "apply-patch", unix: "apply_patch", win: "apply_patch.exe" },
	{ dir: "exec", unix: "exec_bridge", win: "exec_bridge.exe" },
	{ dir: "view-image", unix: "view_image", win: "view_image.exe" },
	{ dir: "web-run", unix: "web_run", win: "web_run.exe" },
	{ dir: "imagegen", unix: "imagegen", win: "imagegen.exe" },
];

const missing = [];
for (const platformArch of platforms) {
	for (const tool of tools) {
		const exe = platformArch.startsWith("win32-") ? tool.win : tool.unix;
		const path = join("src", "tools", tool.dir, "bin", platformArch, exe);
		if (!existsSync(path)) missing.push(path);
	}
}

if (missing.length > 0) {
	console.error("Refusing to publish: bundled Codex tool binaries are incomplete.");
	console.error("Missing:");
	for (const path of missing) console.error(`  - ${path}`);
	console.error("Run the GitHub Actions binary workflow and commit the downloaded artifacts.");
	process.exit(1);
}

console.log("All bundled Codex tool binaries are present.");
