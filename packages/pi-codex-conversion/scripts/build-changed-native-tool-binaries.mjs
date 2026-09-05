#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const tools = [
	{ key: "apply-patch", packageName: "codex-apply-patch", binName: "apply_patch", script: "build:apply-patch", roots: ["src/tools/apply-patch/rust/", "src/tools/rust/crates/pi-apply-patch-fs/", "src/tools/rust/crates/codex-utils-absolute-path/", "src/tools/rust/crates/codex-utils-path-uri/", "scripts/build-apply-patch-binary.mjs"] },
	{ key: "exec", packageName: "codex-exec-shim", binName: "exec_bridge", script: "build:native-tool", roots: ["src/tools/exec/rust/", "src/tools/rust/crates/codex-utils-pty/"] },
	{ key: "view-image", packageName: "codex-view-image", binName: "view_image", script: "build:native-tool", roots: ["src/tools/view-image/rust/", "src/tools/rust/crates/codex-utils-cache/", "src/tools/rust/crates/codex-utils-image/"] },
];

const voice = {
	key: "voice",
	script: "build:voice-helper",
	roots: [
		"src/voice/rust/",
		"scripts/build-voice-helper.mjs",
		"packages/pi-gippity-control/src/voice/rust/",
		"packages/pi-gippity-control/scripts/build-voice-helper.mjs",
	],
};

const allTargetKeys = new Set([...tools.map((tool) => tool.key), voice.key]);
const allRoots = [
	"src/tools/Cargo.toml",
	"src/tools/Cargo.lock",
	"scripts/build-native-tool-binary.mjs",
];

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: options.capture ? "pipe" : "inherit", encoding: "utf8", env: process.env });
	if (result.status !== 0) {
		if (options.capture) {
			if (result.stdout) process.stdout.write(result.stdout);
			if (result.stderr) process.stderr.write(result.stderr);
		}
		process.exit(result.status ?? 1);
	}
	return result.stdout ?? "";
}

function git(args) {
	return run("git", args, { capture: true }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function hasCommit(rev) {
	if (!rev) return false;
	const result = spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], { stdio: "ignore", env: process.env });
	return result.status === 0;
}

function isAncestor(base, head) {
	const result = spawnSync("git", ["merge-base", "--is-ancestor", base, head], { stdio: "ignore", env: process.env });
	if (result.status !== 0 && result.status !== 1) throw new Error(`Cannot compare ${base} and ${head}`);
	return result.status === 0;
}

function changedFiles() {
	const explicit = process.env.CHANGED_FILES?.split(/\r?\n|,/).map((line) => line.trim()).filter(Boolean);
	if (explicit?.length) return explicit;

	const base = process.env.BASE_SHA;
	const head = process.env.HEAD_SHA || process.env.GITHUB_SHA || "HEAD";
	const fallbackBase = process.env.FALLBACK_BASE_REF || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
	if (base) {
		if (!hasCommit(base) || !isAncestor(base, head)) throw new Error(`Native build base ${base} is unavailable or not an ancestor`);
		return git(["diff", "--name-only", base, head]);
	}

	// Plan the whole unshipped branch: a superseded build may have been cancelled.
	// Resetting onto main then naturally selects nothing.
	if (hasCommit(fallbackBase)) {
		return git(["diff", "--name-only", `${fallbackBase}...${head}`]);
	}
	if (process.env.GITHUB_ACTIONS === "true") throw new Error("Cannot resolve native build base in CI");

	return git(["diff", "--name-only", "HEAD"]);
}

function normalize(path) {
	return path.replace(/^packages\/pi-codex-conversion\//, "");
}

const planned = process.env.CODEX_NATIVE_TARGETS;
const targets = planned === undefined ? [] : JSON.parse(planned);
if (!Array.isArray(targets) || targets.some((key) => !allTargetKeys.has(key))) {
	throw new Error("Invalid CODEX_NATIVE_TARGETS build plan");
}
const changed = planned === undefined ? changedFiles().map(normalize) : [];
const selected = new Set(targets);

if (process.argv.includes("--all") || process.env.FORCE_ALL_CODEX_TOOL_BUILDS === "1") {
	for (const key of allTargetKeys) selected.add(key);
}

for (const file of changed) {
	if (allRoots.some((root) => file === root || file.startsWith(root))) {
		for (const tool of tools) selected.add(tool.key);
		continue;
	}
	if (file.startsWith("src/tools/rust/")) {
		for (const tool of tools) selected.add(tool.key);
		continue;
	}
	for (const tool of [...tools, voice]) {
		if (tool.roots.some((root) => file.startsWith(root))) selected.add(tool.key);
	}
}

if (process.argv.includes("--list")) {
	console.log(JSON.stringify([...selected]));
	process.exit(0);
}

if (selected.size === 0) {
	console.log("No native target changes detected.");
	process.exit(0);
}

console.log(`Changed native targets: ${[...selected].join(", ")}`);
for (const tool of tools) {
	if (!selected.has(tool.key)) continue;
	if (tool.script === "build:apply-patch") {
		run("bun", ["run", tool.script]);
	} else {
		run("bun", ["run", tool.script, tool.packageName, tool.binName]);
	}
}
if (selected.has(voice.key)) run("bun", ["run", voice.script]);
