#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src/audio/rust");
const executable =
	process.platform === "win32" ? "grok-audio.exe" : "grok-audio";
const destination = join(
	root,
	"src/audio/bin",
	`${process.platform}-${process.arch}`,
);
mkdirSync(destination, { recursive: true });
const result = spawnSync("cargo", ["build", "--release", "--locked"], {
	cwd: source,
	stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

function capture(command, args) {
	const result = spawnSync(command, args, {
		cwd: source,
		encoding: "utf8",
		maxBuffer: Number.POSITIVE_INFINITY,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout;
}
const host = capture("rustc", ["-vV"]).match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("Could not identify the Rust host target");
const metadata = JSON.parse(
	capture("cargo", [
		"metadata",
		"--locked",
		"--offline",
		"--format-version",
		"1",
		"--filter-platform",
		host,
	]),
);
const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
const dependencies = metadata.packages.filter(
	(pkg) => pkg.source && resolved.has(pkg.id),
);
const notices = dependencies.map((pkg) => {
	// These crate archives omit their workspace license; use the same upstream terms.
	const licenseOwner =
		pkg.name === "sonora-aec3"
			? "sonora"
			: pkg.name === "dasp_sample"
				? "cpal"
				: pkg.name;
	const owner = dependencies.find(
		(candidate) => candidate.name === licenseOwner,
	);
	const directory = dirname(owner.manifest_path);
	const files = readdirSync(directory, { withFileTypes: true })
		.filter(
			(file) =>
				file.isFile() &&
				/^(licen[sc]e|copying|notice)(?:[._-]|$)/i.test(file.name),
		)
		.map((file) => file.name)
		.sort();
	if (!files.length) throw new Error(`Missing license notice for ${pkg.name}`);
	return `${pkg.name} ${pkg.version}\n${pkg.license}\n${pkg.repository ?? ""}\n${(pkg.authors ?? []).join(", ")}\n\n${files.map((file) => readFileSync(join(directory, file), "utf8")).join("\n")}`;
});
writeFileSync(join(destination, "LICENSES.txt"), notices.join("\n\n---\n\n"));
const binary = join(destination, executable);
copyFileSync(join(source, "target/release", executable), binary);
if (process.platform !== "win32") chmodSync(binary, 0o755);
console.log(`Built ${binary}`);
