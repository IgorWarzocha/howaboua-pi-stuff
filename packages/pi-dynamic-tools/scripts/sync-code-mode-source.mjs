#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceDir = process.env.CODEX_SOURCE_DIR ?? process.argv[2];
if (!sourceDir)
	throw new Error("Set CODEX_SOURCE_DIR or pass the Codex checkout path.");
const codex = resolve(sourceDir);
const ref = process.env.CODEX_REF ?? "rust-v0.144.1";
const root = resolve(import.meta.dirname, "..");
const vendor = join(root, "vendor", "code-mode-src");
const temporary = mkdtempSync(join(tmpdir(), "pi-dynamic-tools-sync-"));
try {
	const archive = execFileSync("git", [
		"-C",
		codex,
		"archive",
		ref,
		"codex-rs/code-mode/src",
		"codex-rs/code-mode-host/src",
		"codex-rs/code-mode-protocol/src",
		"codex-rs/protocol/src/tool_name.rs",
		"LICENSE",
		"NOTICE",
	]);
	const tar = execFileSync("tar", ["-x", "-C", temporary], { input: archive });
	void tar;
	for (const crate of ["code-mode", "code-mode-host", "code-mode-protocol"]) {
		const destination = join(vendor, "crates", crate, "src");
		rmSync(destination, { recursive: true, force: true });
		cpSync(join(temporary, "codex-rs", crate, "src"), destination, {
			recursive: true,
		});
	}
	const protocol = join(vendor, "crates", "codex-protocol", "src");
	mkdirSync(protocol, { recursive: true });
	cpSync(
		join(temporary, "codex-rs", "protocol", "src", "tool_name.rs"),
		join(protocol, "tool_name.rs"),
	);
	cpSync(join(temporary, "LICENSE"), join(vendor, "LICENSE"));
	cpSync(join(temporary, "NOTICE"), join(vendor, "NOTICE"));
	for (const path of findTestFiles(join(vendor, "crates")))
		rmSync(path, { force: true });
	const commit = execFileSync(
		"git",
		["-C", codex, "rev-parse", `${ref}^{commit}`],
		{ encoding: "utf8" },
	).trim();
	writeFileSync(join(vendor, "UPSTREAM"), `${commit}\n`);
	console.log(`Synced Codex code mode from ${ref} (${commit})`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}

function findTestFiles(dir) {
	return execFileSync(
		"find",
		[
			dir,
			"-type",
			"f",
			"(",
			"-name",
			"*_tests.rs",
			"-o",
			"-name",
			"tests.rs",
			")",
		],
		{
			encoding: "utf8",
		},
	)
		.split("\n")
		.filter(Boolean);
}
