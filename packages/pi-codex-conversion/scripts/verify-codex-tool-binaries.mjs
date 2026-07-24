#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64"];
const tools = [
	{ dir: "../voice", unix: "pi-codex-voice", win: "pi-codex-voice.exe" },
	{ dir: "apply-patch", unix: "apply_patch", win: "apply_patch.exe" },
	{ dir: "exec", unix: "exec_bridge", win: "exec_bridge.exe" },
	{ dir: "view-image", unix: "view_image", win: "view_image.exe" },
	{ dir: "web-run", unix: "web_run", win: "web_run.exe" },
	{ dir: "imagegen", unix: "imagegen", win: "imagegen.exe" },
];

const missing = [];
const notExecutable = [];
for (const platformArch of platforms) {
	for (const tool of tools) {
		const exe = platformArch.startsWith("win32-") ? tool.win : tool.unix;
		const path = tool.dir === "../voice"
			? join("src", "voice", "bin", platformArch, exe)
			: join("src", "tools", tool.dir, "bin", platformArch, exe);
		if (!existsSync(path)) missing.push(path);
		else if (!platformArch.startsWith("win32-") && (statSync(path).mode & 0o111) === 0) notExecutable.push(path);
	}
}

if (missing.length > 0 || notExecutable.length > 0) {
	console.error("Refusing to publish: bundled Codex tool binaries are incomplete.");
	if (missing.length > 0) {
		console.error("Missing:");
		for (const path of missing) console.error(`  - ${path}`);
	}
	if (notExecutable.length > 0) {
		console.error("Not executable:");
		for (const path of notExecutable) console.error(`  - ${path}`);
	}
	console.error("Run the GitHub Actions binary workflow and commit the downloaded artifacts.");
	process.exit(1);
}

const builtResolver = resolve("dist", "voice", "binary.js");
if (!existsSync(builtResolver)) {
	console.error("Refusing to publish: built voice helper resolver is missing. Run `bun run build` first.");
	process.exit(1);
}
const { resolveVoiceHelperBinary } = await import(pathToFileURL(builtResolver).href);
if (!resolveVoiceHelperBinary()) {
	console.error(`Refusing to publish: built package cannot resolve the bundled voice helper for ${process.platform}-${process.arch}.`);
	process.exit(1);
}

console.log("All bundled Codex tool binaries are present.");
