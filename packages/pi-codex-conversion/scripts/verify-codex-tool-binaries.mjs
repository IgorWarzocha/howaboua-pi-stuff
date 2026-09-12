#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyPatchPlatforms, applyPatchSource, sha256File } from "./build-apply-patch-binary.mjs";

const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64"];
const tools = [
	{ dir: "../voice", unix: "pi-codex-voice", win: "pi-codex-voice.exe" },
	{ dir: "apply-patch", unix: "apply_patch", win: "apply_patch.exe" },
	{ dir: "exec", unix: "exec_bridge", win: "exec_bridge.exe" },
	{ dir: "view-image", unix: "view_image", win: "view_image.exe" },
];

const missing = [];
const notExecutable = [];
const invalidProvenance = [];
const expectedApplyPatchSource = applyPatchSource(resolve("src", "tools"));

function checkApplyPatchProvenance(binaryPath, platformArch) {
	const provenancePath = `${binaryPath}.provenance.json`;
	if (!existsSync(provenancePath)) {
		missing.push(provenancePath);
		return;
	}

	try {
		const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
		const mismatches = [];
		if (provenance?.schemaVersion !== 1) mismatches.push("schemaVersion must be 1");
		for (const field of ["repository", "revision", "inputsSha256"]) {
			if (provenance?.source?.[field] !== expectedApplyPatchSource[field]) mismatches.push(`source.${field} does not match the bundled source`);
		}
		if (provenance?.binary?.sha256 !== sha256File(binaryPath)) mismatches.push("binary.sha256 does not match the bundled binary");
		if (provenance?.build?.target !== applyPatchPlatforms[platformArch]) mismatches.push(`build.target must be ${applyPatchPlatforms[platformArch]}`);
		if (typeof provenance?.build?.rustc !== "string" || !provenance.build.rustc.startsWith("rustc ")) mismatches.push("build.rustc is missing");
		if (typeof provenance?.build?.cargo !== "string" || !provenance.build.cargo.startsWith("cargo ")) mismatches.push("build.cargo is missing");
		for (const mismatch of mismatches) invalidProvenance.push(`${provenancePath}: ${mismatch}`);
	} catch (error) {
		invalidProvenance.push(`${provenancePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

for (const platformArch of platforms) {
	for (const tool of tools) {
		const exe = platformArch.startsWith("win32-") ? tool.win : tool.unix;
		const path = tool.dir === "../voice"
			? join("src", "voice", "bin", platformArch, exe)
			: join("src", "tools", tool.dir, "bin", platformArch, exe);
		if (!existsSync(path)) {
			missing.push(path);
			continue;
		}
		if (!platformArch.startsWith("win32-") && (statSync(path).mode & 0o111) === 0) notExecutable.push(path);
		if (tool.dir === "apply-patch") checkApplyPatchProvenance(path, platformArch);
	}
}

if (missing.length > 0 || notExecutable.length > 0 || invalidProvenance.length > 0) {
	console.error("Refusing to publish: bundled Codex tool binaries are incomplete.");
	if (missing.length > 0) {
		console.error("Missing:");
		for (const path of missing) console.error(`  - ${path}`);
	}
	if (notExecutable.length > 0) {
		console.error("Not executable:");
		for (const path of notExecutable) console.error(`  - ${path}`);
	}
	if (invalidProvenance.length > 0) {
		console.error("Invalid apply_patch provenance:");
		for (const problem of invalidProvenance) console.error(`  - ${problem}`);
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
