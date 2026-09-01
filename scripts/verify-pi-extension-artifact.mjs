#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const workspacePackages = new Map(
	readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const root = join(repoRoot, "packages", entry.name);
			const manifest = join(root, "package.json");
			if (!existsSync(manifest)) return [];
			const pkg = JSON.parse(readFileSync(manifest, "utf8"));
			return typeof pkg.name === "string" ? [[pkg.name, { root, pkg }]] : [];
		}),
);
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
		env: { ...process.env, ...options.env },
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
	const sources = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));
	const peerSpecifierPattern = /["'](@earendil-works\/pi-[^"']+|typebox(?:\/[^"']+)?)["']/g;
	const staticSpecifierPattern = /^\s*(?:import|export)\s+(?:[^"'\n]*?\sfrom\s*)?["']([^"']+)["']/gm;
	const dynamicSpecifierPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
	const peerSpecifiers = (source) => [...source.matchAll(peerSpecifierPattern)].map((match) => match[1]).filter(Boolean);
	const staticSpecifiers = (source) => [...source.matchAll(staticSpecifierPattern)].map((match) => match[1]).filter(Boolean);
	const dynamicSpecifiers = (source) => [...source.matchAll(dynamicSpecifierPattern)].map((match) => match[1]).filter(Boolean);
	const localModule = (from, specifier) => {
		if (!specifier.startsWith(".")) return undefined;
		const path = resolve(dirname(from), specifier);
		return sources.has(path) ? path : undefined;
	};
	for (const path of files) {
		const source = sources.get(path) ?? "";
		for (const specifier of peerSpecifiers(source)) {
			if (specifier && !allowedLoaderModules.has(specifier)) failures.push({ path, specifier });
		}
		for (const specifier of dynamicSpecifiers(source)) {
			if (allowedLoaderModules.has(specifier)) {
				failures.push({ path, specifier, reason: "native dynamic import bypasses Pi loader aliases" });
				continue;
			}
			if (!specifier.startsWith(".")) continue;
			const root = localModule(path, specifier);
			if (!root) {
				failures.push({ path, specifier, reason: "unresolved local dynamic import" });
				continue;
			}
			const pending = [root];
			const visited = new Set();
			while (pending.length > 0) {
				const current = pending.pop();
				if (!current || visited.has(current)) continue;
				visited.add(current);
				const currentSource = sources.get(current) ?? "";
				for (const peer of peerSpecifiers(currentSource)) {
					if (allowedLoaderModules.has(peer)) {
						failures.push({
							path,
							specifier,
							reason: `lazy graph reaches Pi loader alias ${peer} in ${current}`,
						});
					}
				}
				for (const childSpecifier of staticSpecifiers(currentSource)) {
					const child = localModule(current, childSpecifier);
					if (child) pending.push(child);
				}
			}
		}
	}
	if (failures.length === 0) return;
	console.error("Pi extension artifact violates its loader module boundary:");
	for (const failure of failures) {
		console.error(`  ${failure.path}: ${failure.specifier}${failure.reason ? ` (${failure.reason})` : ""}`);
	}
	process.exit(1);
}

function packPackage(packageRoot, tempRoot) {
	const output = run(
		"npm",
		["pack", "--ignore-scripts", "--json", "--pack-destination", tempRoot, packageRoot],
		{
			cwd: repoRoot,
			capture: true,
			env: { npm_config_dry_run: "false", NPM_CONFIG_DRY_RUN: "false" },
		},
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
	const changelogRuntime = join(packageRoot, "changelog.js");
	if (existsSync(changelogRuntime)) cpSync(changelogRuntime, join(unpacked, "changelog.js"));
	return unpacked;
}

function stagePackageUnderNodeModules(packageRoot, isolatedRoot) {
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
		throw new Error(`${packageRoot} has no package name`);
	}
	const stagedPackage = join(isolatedRoot, "node_modules", ...packageJson.name.split("/"));
	mkdirSync(dirname(stagedPackage), { recursive: true });
	cpSync(packageRoot, stagedPackage, { recursive: true });
	return stagedPackage;
}

function installRuntimeDependencies(packageRoot, isolatedRoot) {
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	const workspaceJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
	const externalDependencies = {};
	const localDependencies = new Set();
	const visited = new Set([packageJson.name]);
	const collect = (pkg) => {
		const optionalPeers = pkg.peerDependenciesMeta ?? {};
		for (const [name, range] of [
			...Object.entries(pkg.dependencies ?? {}),
			...Object.entries(pkg.peerDependencies ?? {}).filter(
				([name]) => optionalPeers[name]?.optional !== true,
			),
		]) {
			const workspace = workspacePackages.get(name);
			if (workspace) {
				if (visited.has(name)) continue;
				visited.add(name);
				localDependencies.add(name);
				collect(workspace.pkg);
				continue;
			}
			externalDependencies[name] = workspaceJson.devDependencies?.[name] ?? range;
		}
	};
	collect(packageJson);
	writeFileSync(join(isolatedRoot, "package.json"), JSON.stringify({
		private: true,
		dependencies: externalDependencies,
	}));
	run("npm", ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", "--package-lock=false"], {
		cwd: isolatedRoot,
		capture: true,
		env: { npm_config_dry_run: "false", NPM_CONFIG_DRY_RUN: "false" },
	});
	return [...localDependencies];
}

function stageWorkspaceDependencies(names, isolatedRoot) {
	const packRoot = join(isolatedRoot, "workspace-packs");
	mkdirSync(packRoot);
	for (const name of names) {
		const workspace = workspacePackages.get(name);
		if (!workspace) throw new Error(`Missing workspace dependency ${name}`);
		const output = run(
			"npm",
			["pack", "--ignore-scripts", "--json", "--pack-destination", packRoot, workspace.root],
			{
				cwd: repoRoot,
				capture: true,
				env: { npm_config_dry_run: "false", NPM_CONFIG_DRY_RUN: "false" },
			},
		);
		const packed = JSON.parse(output);
		const filename = Array.isArray(packed) && typeof packed[0]?.filename === "string"
			? packed[0].filename
			: undefined;
		if (!filename) throw new Error(`npm pack did not report an artifact for ${name}`);
		const staged = join(isolatedRoot, "node_modules", ...name.split("/"));
		rmSync(staged, { recursive: true, force: true });
		mkdirSync(staged, { recursive: true });
		run("tar", ["-xzf", join(packRoot, filename), "--strip-components=1", "-C", staged]);
	}
}

async function loadLazyLocalModules(packageRoot) {
	const dist = join(packageRoot, "dist");
	const files = filesUnder(dist, (path) => /\.(?:c|m)?js$/.test(path));
	const dynamicSpecifierPattern = /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g;
	const modules = new Set();
	for (const path of files) {
		const source = readFileSync(path, "utf8");
		for (const match of source.matchAll(dynamicSpecifierPattern)) {
			if (match[1]) modules.add(resolve(dirname(path), match[1]));
		}
	}
	for (const path of modules) await import(pathToFileURL(path).href);
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
		const workspaceDependencies = installRuntimeDependencies(isolatedPackage, tempRoot);
		stageWorkspaceDependencies(workspaceDependencies, tempRoot);
		const stagedPackage = stagePackageUnderNodeModules(isolatedPackage, tempRoot);
		await loadPackedExtensions(stagedPackage, tempRoot);
		await loadLazyLocalModules(stagedPackage);
		console.log(`Verified Pi extension artifact: ${packageJson.name}`);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}
