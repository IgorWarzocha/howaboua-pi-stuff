#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const applyPatchPlatforms = {
	"darwin-arm64": "aarch64-apple-darwin",
	"darwin-x64": "x86_64-apple-darwin",
	"linux-arm64": "aarch64-unknown-linux-gnu",
	"linux-x64": "x86_64-unknown-linux-gnu",
	"win32-arm64": "aarch64-pc-windows-msvc",
	"win32-x64": "x86_64-pc-windows-msvc",
};

const sourceInputs = [
	"Cargo.lock",
	"Cargo.toml",
	"apply-patch/rust",
	"rust/UPSTREAM.apply-patch",
	"rust/crates/codex-utils-absolute-path",
	"rust/crates/codex-utils-path-uri",
	"rust/crates/pi-apply-patch-fs",
];

function inputFiles(sourceRoot) {
	const files = [];
	const inputName = (path) => relative(sourceRoot, path).split(sep).join("/");
	function visit(path) {
		const stat = statSync(path);
		if (stat.isFile()) {
			files.push(path);
			return;
		}
		if (!stat.isDirectory()) throw new Error(`Unsupported apply_patch source input: ${path}`);
		for (const entry of readdirSync(path, { withFileTypes: true })) visit(join(path, entry.name));
	}
	for (const input of sourceInputs) visit(join(sourceRoot, input));
	return files.sort((left, right) => inputName(left) < inputName(right) ? -1 : inputName(left) > inputName(right) ? 1 : 0);
}

export function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function applyPatchSource(sourceRoot) {
	const upstream = readFileSync(join(sourceRoot, "rust", "UPSTREAM.apply-patch"), "utf8").trim().match(/^(\S+) ([0-9a-f]{40})$/);
	if (!upstream) throw new Error("Invalid rust/UPSTREAM.apply-patch; expected '<repository> <40-character commit>'");

	const hash = createHash("sha256");
	for (const path of inputFiles(sourceRoot)) {
		// Keep one source digest across native checkouts with different Git line-ending settings.
		const content = Buffer.from(readFileSync(path, "utf8").replaceAll("\r\n", "\n"));
		const name = relative(sourceRoot, path).split(sep).join("/");
		hash.update(`${name}\0${content.length}\0`);
		hash.update(content);
		hash.update("\0");
	}
	return {
		repository: upstream[1],
		revision: upstream[2],
		inputsSha256: hash.digest("hex"),
	};
}

function commandOutput(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8", env: process.env });
	if (result.status !== 0) throw new Error(`Cannot record ${command} provenance: ${result.stderr?.trim() || `exit ${result.status ?? 1}`}`);
	return result.stdout.trim();
}

function buildProvenance(sourceRoot, binary, platformArch) {
	const rustc = commandOutput("rustc", ["--version", "--verbose"]);
	const target = rustc.match(/^host: (\S+)$/m)?.[1];
	if (!target) throw new Error("Cannot determine the Rust target from `rustc --version --verbose`");
	if (target !== applyPatchPlatforms[platformArch]) {
		throw new Error(`Rust target ${target} does not match bundled platform ${platformArch}`);
	}
	return {
		schemaVersion: 1,
		source: applyPatchSource(sourceRoot),
		binary: { sha256: sha256File(binary) },
		build: {
			target,
			rustc: rustc.split(/\r?\n/, 1)[0],
			cargo: commandOutput("cargo", ["--version"]),
		},
	};
}

function main() {
	const sourceRoot = resolve(process.env.APPLY_PATCH_SOURCE_DIR ?? process.argv[2] ?? "src/tools");
	const platform = process.platform;
	const arch = process.arch;
	const platformArch = `${platform}-${arch}`;
	if (!applyPatchPlatforms[platformArch]) throw new Error(`Unsupported apply_patch build platform: ${platformArch}`);
	const exe = platform === "win32" ? "apply_patch.exe" : "apply_patch";
	const outDir = resolve("src", "tools", "apply-patch", "bin", platformArch);
	const source = join(sourceRoot, "target", "release", exe);

	const cargo = spawnSync("cargo", ["build", "--release", "--locked", "-p", "codex-apply-patch"], { cwd: sourceRoot, stdio: "inherit", env: process.env });
	if (cargo.status !== 0) process.exit(cargo.status ?? 1);
	if (!existsSync(source)) {
		console.error(`Expected ${source} after cargo build`);
		process.exit(1);
	}
	mkdirSync(outDir, { recursive: true });
	const dest = join(outDir, basename(source));
	copyFileSync(source, dest);
	if (platform !== "win32") chmodSync(dest, 0o755);
	const provenance = `${dest}.provenance.json`;
	writeFileSync(provenance, `${JSON.stringify(buildProvenance(sourceRoot, dest, platformArch), null, 2)}\n`);
	console.log(`Wrote ${dest} and ${provenance}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
