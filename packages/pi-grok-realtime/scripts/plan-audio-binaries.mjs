#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packagePath = "packages/pi-grok-realtime";
const inputPaths = [
	`${packagePath}/src/audio/rust`,
	`${packagePath}/scripts/build-audio-helper.mjs`,
	`${packagePath}/scripts/verify-audio-binaries.mjs`,
	`${packagePath}/scripts/plan-audio-binaries.mjs`,
	`${packagePath}/scripts/licenses`,
	".github/workflows/grok-audio-binaries.yml",
	".node-version",
];
const files = execFileSync(
	"git",
	[
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
		...inputPaths,
	],
	{ cwd: root, encoding: "utf8" },
)
	.split("\0")
	.filter(Boolean)
	.sort();
const hash = createHash("sha256");
for (const file of files) {
	hash
		.update(file)
		.update("\0")
		.update(readFileSync(resolve(root, file)))
		.update("\0");
}
const inputs = hash.digest("hex");
const binaries = {};
const missing = [];
for (const platform of ["linux", "darwin", "win32"]) {
	for (const arch of ["x64", "arm64"]) {
		for (const name of [
			platform === "win32" ? "grok-audio.exe" : "grok-audio",
			"LICENSES.txt",
		]) {
			const file = `${platform}-${arch}/${name}`;
			const path = resolve(root, packagePath, "src/audio/bin", file);
			try {
				if (!statSync(path).isFile() || statSync(path).size === 0)
					missing.push(file);
				else
					binaries[file] = createHash("sha256")
						.update(readFileSync(path))
						.digest("hex");
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				missing.push(file);
			}
		}
	}
}
const manifest = resolve(root, packagePath, "src/audio/bin/build-inputs.json");
if (process.argv.includes("--stamp")) {
	if (missing.length)
		throw new Error(
			`Cannot stamp incomplete audio bundle: ${missing.join(", ")}`,
		);
	writeFileSync(
		manifest,
		`${JSON.stringify({ version: 1, inputs, binaries }, null, 2)}\n`,
	);
} else {
	let previous;
	try {
		previous = JSON.parse(readFileSync(manifest, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
	}
	const current =
		previous?.version === 1 &&
		previous.inputs === inputs &&
		Object.entries(binaries).every(
			([file, digest]) => previous.binaries?.[file] === digest,
		);
	const rebuild = missing.length > 0 || !current;
	if (process.argv.includes("--check") && rebuild)
		throw new Error(
			"Grok audio bundle is missing or stale. Build and bundle it on the source branch before publishing.",
		);
	console.log(
		JSON.stringify({
			rebuild,
			inputs,
			reason: missing.length
				? `Missing: ${missing.join(", ")}`
				: current
					? "Audio bundle is current"
					: "Audio bundle fingerprint is missing or stale",
		}),
	);
}
