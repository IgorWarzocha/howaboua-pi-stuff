#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const tools = [
	{ key: "apply-patch", packageName: "codex-apply-patch", binName: "apply_patch", script: "build:apply-patch", roots: ["src/tools/apply-patch/rust/", "src/tools/rust/crates/codex-exec-server/", "src/tools/rust/crates/codex-utils-absolute-path/"] },
	{ key: "exec", packageName: "codex-exec-shim", binName: "exec_bridge", script: "build:path-tool", roots: ["src/tools/exec/rust/", "src/tools/rust/crates/codex-utils-pty/"] },
	{ key: "view-image", packageName: "codex-view-image", binName: "view_image", script: "build:path-tool", roots: ["src/tools/view-image/rust/", "src/tools/rust/crates/codex-utils-cache/", "src/tools/rust/crates/codex-utils-image/"] },
	{ key: "web-run", packageName: "codex-web-run", binName: "web_run", script: "build:path-tool", roots: ["src/tools/web-run/rust/"] },
	{ key: "imagegen", packageName: "codex-imagegen", binName: "imagegen", script: "build:path-tool", roots: ["src/tools/imagegen/rust/"] },
];

const allToolKeys = new Set(tools.map((tool) => tool.key));
const allRoots = [
	"src/tools/Cargo.toml",
	"src/tools/Cargo.lock",
];

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: options.capture ? "pipe" : "inherit", encoding: "utf8", env: process.env });
	if (result.status !== 0) {
		if (options.capture) {
			if (result.stdout) process.stdout.write(result.stdout);
			if (result.stderr) process.stderr.write(result.stderr);
		}
		if (options.optional) return undefined;
		process.exit(result.status ?? 1);
	}
	return result.stdout ?? "";
}

function git(args, options = {}) {
	const output = run("git", args, { capture: true, optional: options.optional });
	return output?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function hasCommit(rev) {
	if (!rev) return false;
	const result = spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], { stdio: "ignore", env: process.env });
	return result.status === 0;
}

function diffNames(base, head) {
	return git(["diff", "--name-only", `${base}...${head}`], { optional: true });
}

function changedFiles() {
	const explicit = process.env.CHANGED_FILES?.split(/\r?\n|,/).map((line) => line.trim()).filter(Boolean);
	if (explicit?.length) return explicit;

	const base = process.env.BASE_SHA || process.env.GITHUB_EVENT_BEFORE;
	const head = process.env.HEAD_SHA || process.env.GITHUB_SHA || "HEAD";
	if (base && !/^0+$/.test(base)) {
		if (hasCommit(base)) {
			const changed = diffNames(base, head);
			if (changed) return changed;
		} else {
			console.warn(`Base commit ${base} is not available in this checkout; falling back to default branch diff.`);
		}
	}

	const fallbackBase = process.env.FALLBACK_BASE_REF || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
	if (hasCommit(fallbackBase)) {
		const changed = diffNames(fallbackBase, head);
		if (changed) return changed;
	}

	const local = git(["diff", "--name-only", "HEAD"]) ?? [];
	const staged = git(["diff", "--cached", "--name-only", "HEAD"]) ?? [];
	return [...new Set([...local, ...staged])];
}

function normalize(path) {
	return path.replace(/^packages\/pi-codex-conversion\//, "");
}

const changed = changedFiles().map(normalize);
const selected = new Set();

if (process.argv.includes("--all") || process.env.FORCE_ALL_CODEX_TOOL_BUILDS === "1") {
	for (const key of allToolKeys) selected.add(key);
}

for (const file of changed) {
	if (allRoots.some((root) => file === root || file.startsWith(root))) {
		for (const key of allToolKeys) selected.add(key);
		continue;
	}
	if (file.startsWith("src/tools/rust/")) {
		for (const key of allToolKeys) selected.add(key);
		continue;
	}
	for (const tool of tools) {
		if (tool.roots.some((root) => file.startsWith(root))) selected.add(tool.key);
	}
}

if (changed.length === 0 || selected.size === 0) {
	console.log("No Rust tool changes detected.");
	process.exit(0);
}

console.log(`Changed Rust tools: ${[...selected].join(", ")}`);
for (const tool of tools) {
	if (!selected.has(tool.key)) continue;
	if (tool.script === "build:apply-patch") {
		run("bun", ["run", tool.script]);
	} else {
		run("bun", ["run", tool.script, tool.packageName, tool.binName]);
	}
}
