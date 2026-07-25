#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoArg = process.argv[2] ?? process.env["CODEX_REPO"];
if (!repoArg) {
	console.error("Usage: bun run sync:apply-patch-source -- <path-to-openai-codex>");
	process.exit(2);
}

const codexRepo = resolve(repoArg);
const codexRs = join(codexRepo, "codex-rs");
const applyPatchSource = join(codexRs, "apply-patch", "src");
const pathUriSource = join(codexRs, "utils", "path-uri", "src");
const absolutePathSource = join(codexRs, "utils", "absolute-path", "src");
const applyPatchDest = resolve("src/tools/apply-patch/rust");
const pathUriDest = resolve("src/tools/rust/crates/codex-utils-path-uri");
const absolutePathDest = resolve("src/tools/rust/crates/codex-utils-absolute-path");

function run(cmd, args, cwd) {
	const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	return result.stdout.trim();
}

function replaceRustSources(source, destination) {
	mkdirSync(destination, { recursive: true });
	for (const entry of readdirSync(destination)) {
		if (entry.endsWith(".rs")) rmSync(join(destination, entry), { force: true });
	}
	for (const entry of readdirSync(source)) {
		if (entry.endsWith(".rs")) cpSync(join(source, entry), join(destination, entry));
	}
}

for (const source of [applyPatchSource, pathUriSource, absolutePathSource]) {
	if (!existsSync(source)) {
		console.error(`Missing Codex source directory: ${source}`);
		process.exit(2);
	}
}

const commit = run("git", ["rev-parse", "HEAD"], codexRepo);
const status = run("git", ["status", "--short"], codexRepo)
	.split("\n")
	.filter((line) => line && !line.match(/^\?\? \.pi\/?/))
	.join("\n");
if (status) {
	console.error(`Refusing to sync from dirty Codex checkout:\n${status}`);
	process.exit(1);
}

const applyPatchEngineFiles = ["invocation.rs", "lib.rs", "main.rs", "parser.rs", "seek_sequence.rs", "streaming_parser.rs"];
for (const entry of applyPatchEngineFiles) {
	cpSync(join(applyPatchSource, entry), join(applyPatchDest, entry));
}
replaceRustSources(pathUriSource, pathUriDest);
replaceRustSources(absolutePathSource, absolutePathDest);

const instructions = join(codexRs, "apply-patch", "apply_patch_tool_instructions.md");
rmSync(join(applyPatchDest, "apply_patch_tool_instructions.md"), { force: true });
if (existsSync(instructions)) cpSync(instructions, join(applyPatchDest, "apply_patch_tool_instructions.md"));

writeFileSync(resolve("src/tools/rust/UPSTREAM.apply-patch"), `openai/codex ${commit}\n`);
console.log(`Synced apply_patch, path-uri, and absolute-path sources from openai/codex ${commit}`);
console.log("Local Cargo manifests, Pi's structured-output CLI adapter, and the pi-apply-patch-fs adapter were preserved.");
