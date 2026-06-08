#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const codexRepo = resolve(process.argv[2] ?? "/home/igorw/Frameworks/codex");
const codexRs = join(codexRepo, "codex-rs");
const applyPatchDest = resolve("src/tools/apply-patch/rust");
const absolutePathDest = resolve("src/tools/rust/crates/codex-utils-absolute-path");

function run(cmd, args, cwd) {
	const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	return result.stdout.trim();
}

const commit = run("git", ["rev-parse", "HEAD"], codexRepo);
const status = run("git", ["status", "--short"], codexRepo).split("\n").filter((line) => line && !line.match(/^\?\? \.pi\/?/)).join("\n");
if (status) {
	console.error(`Refusing to sync from dirty Codex checkout:\n${status}`);
	process.exit(1);
}

for (const dest of [applyPatchDest, absolutePathDest]) {
	mkdirSync(dest, { recursive: true });
	for (const entry of ["lib.rs", "main.rs", "parser.rs", "invocation.rs", "seek_sequence.rs", "standalone_executable.rs", "streaming_parser.rs", "absolutize.rs"]) {
		rmSync(join(dest, entry), { force: true });
	}
}
cpSync(join(codexRs, "apply-patch", "src"), applyPatchDest, { recursive: true });
const instructions = join(codexRs, "apply-patch", "apply_patch_tool_instructions.md");
rmSync(join(applyPatchDest, "apply_patch_tool_instructions.md"), { force: true });
if (existsSync(instructions)) cpSync(instructions, join(applyPatchDest, "apply_patch_tool_instructions.md"));
cpSync(join(codexRs, "utils", "absolute-path", "src"), absolutePathDest, { recursive: true });
writeFileSync(resolve("src/tools/rust/UPSTREAM.apply-patch"), `openai/codex ${commit}\n`);
console.log(`Synced apply_patch source from openai/codex ${commit}`);
