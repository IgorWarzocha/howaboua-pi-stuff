#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const codexRepo = resolve(process.argv[2] ?? "/home/igorw/Frameworks/codex");
const codexRs = join(codexRepo, "codex-rs");
const dest = resolve("vendor/apply-patch-src");

function run(cmd, args, cwd) {
	const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	return result.stdout.trim();
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

rmSync(join(dest, "crates", "codex-apply-patch", "src"), { recursive: true, force: true });
rmSync(join(dest, "crates", "codex-utils-absolute-path", "src"), { recursive: true, force: true });
mkdirSync(join(dest, "crates", "codex-apply-patch"), { recursive: true });
mkdirSync(join(dest, "crates", "codex-utils-absolute-path"), { recursive: true });
cpSync(join(codexRs, "apply-patch", "src"), join(dest, "crates", "codex-apply-patch", "src"), { recursive: true });
const instructions = join(codexRs, "apply-patch", "apply_patch_tool_instructions.md");
rmSync(join(dest, "crates", "codex-apply-patch", "apply_patch_tool_instructions.md"), { force: true });
if (existsSync(instructions)) {
	cpSync(instructions, join(dest, "crates", "codex-apply-patch", "apply_patch_tool_instructions.md"));
}
cpSync(join(codexRs, "utils", "absolute-path", "src"), join(dest, "crates", "codex-utils-absolute-path", "src"), { recursive: true });
writeFileSync(join(dest, "UPSTREAM"), `openai/codex ${commit}\n`);

console.log(`Synced apply_patch source from openai/codex ${commit}`);
