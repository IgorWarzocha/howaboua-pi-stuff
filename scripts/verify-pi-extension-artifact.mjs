#!/usr/bin/env node
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const noPack = args.includes("--no-pack");
const packageArgs = args.filter((arg) => !arg.startsWith("--"));
if (packageArgs.length === 0) {
	console.error("Usage: node scripts/verify-pi-extension-artifact.mjs [--no-build] [--no-pack] <package-dir>...");
	process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedLoaderModules = new Set([
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-ai/compat",
	"@earendil-works/pi-ai/oauth",
	"@earendil-works/pi-ai/providers/all",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
	"typebox/compile",
	"typebox/value",
]);

function run(command, commandArgs, options = {}) {
	const result = spawnSync(command, commandArgs, {
		cwd: options.cwd,
		encoding: "utf8",
		stdio: options.capture ? "pipe" : "inherit",
		env: process.env,
	});
	if (result.status !== 0) {
		if (options.capture) {
			if (result.stdout) process.stdout.write(result.stdout);
			if (result.stderr) process.stderr.write(result.stderr);
		}
		process.exit(result.status ?? 1);
	}
	return result.stdout ?? "";
}

function filesUnder(path, predicate = () => true) {
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
		const child = join(path, entry.name);
		if (entry.isDirectory()) return filesUnder(child, predicate);
		return entry.isFile() && predicate(child) ? [child] : [];
	});
}

function verifyLoaderImports(packageRoot) {
	const dist = join(packageRoot, "dist");
	let files;
	try {
		files = filesUnder(dist, (path) => /\.(?:c|m)?js$/.test(path));
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	const failures = [];
	const specifierPattern = /["'](@earendil-works\/pi-[^"']+|typebox\/[^"']+)["']/g;
	for (const path of files) {
		const source = readFileSync(path, "utf8");
		for (const match of source.matchAll(specifierPattern)) {
			const specifier = match[1];
			if (specifier && !allowedLoaderModules.has(specifier)) failures.push({ path, specifier });
		}
	}
	if (failures.length === 0) return;
	console.error("Pi extension artifact imports modules its loader does not expose:");
	for (const failure of failures) {
		console.error(`  ${failure.path}: ${failure.specifier}`);
	}
	process.exit(1);
}

function packPackage(packageRoot, tempRoot) {
	const output = run(
		"npm",
		["pack", "--ignore-scripts", "--json", "--pack-destination", tempRoot, packageRoot],
		{ cwd: repoRoot, capture: true },
	);
	const packed = JSON.parse(output);
	const filename = Array.isArray(packed) && typeof packed[0]?.filename === "string"
		? packed[0].filename
		: undefined;
	if (!filename) throw new Error(`npm pack did not report an artifact for ${packageRoot}`);
	const unpacked = join(tempRoot, "unpacked");
	mkdirSync(unpacked);
	run("tar", ["-xzf", join(tempRoot, filename), "-C", unpacked]);
	return join(unpacked, "package");
}

function copyPackage(packageRoot, tempRoot) {
	const unpacked = join(tempRoot, "package");
	mkdirSync(unpacked);
	cpSync(join(packageRoot, "dist"), join(unpacked, "dist"), { recursive: true });
	cpSync(join(packageRoot, "package.json"), join(unpacked, "package.json"));
	return unpacked;
}

function installRuntimeDependencies(packageRoot, isolatedRoot) {
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	writeFileSync(join(isolatedRoot, "package.json"), JSON.stringify({
		private: true,
		dependencies: packageJson.dependencies ?? {},
	}));
	run("npm", ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", "--package-lock=false"], {
		cwd: isolatedRoot,
		capture: true,
	});
}

async function loadPackedExtensions(packageRoot, isolatedRoot) {
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	const extensionPaths = packageJson.pi?.extensions;
	if (!Array.isArray(extensionPaths) || extensionPaths.length === 0) {
		throw new Error(`${packageJson.name ?? packageRoot} has no pi.extensions entry`);
	}
	const codingAgentIndex = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { loadExtensions } = await import(join(dirname(codingAgentIndex), "core/extensions/loader.js"));
	const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = join(isolatedRoot, "agent");
	try {
		const paths = extensionPaths.map((path) =>
			isAbsolute(path) ? path : resolve(packageRoot, path),
		);
		const result = await loadExtensions(paths, isolatedRoot);
		if (result.errors.length > 0 || result.extensions.length !== paths.length) {
			const detail = result.errors.map((error) => `${error.path}: ${error.error}`).join("\n");
			throw new Error(detail || `loaded ${result.extensions.length}/${paths.length} extensions`);
		}
	} finally {
		if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
	}
}

for (const packageArg of packageArgs) {
	const packageRoot = resolve(repoRoot, packageArg);
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (!noBuild && packageJson.scripts?.build) run("bun", ["run", "build"], { cwd: packageRoot });
	verifyLoaderImports(packageRoot);
	const tempRoot = mkdtempSync(join(tmpdir(), "pi-extension-artifact-"));
	try {
		const isolatedPackage = noPack
			? copyPackage(packageRoot, tempRoot)
			: packPackage(packageRoot, tempRoot);
		installRuntimeDependencies(isolatedPackage, tempRoot);
		await loadPackedExtensions(isolatedPackage, tempRoot);
		console.log(`Verified Pi extension artifact: ${packageJson.name}`);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}
