#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MAX_LIST_ITEMS = 100;
const ARCHIVED_PACKAGE_DIRS = new Set(["pi-codex-conversion-lite"]);
const AGGREGATE_PACKAGE_NAMES = new Set([
	"@howaboua/pi-extensions",
	"@howaboua/pi-skills",
	"@howaboua/pi-stuff",
]);

function commandText(command, args) {
	return [command, ...args].join(" ");
}

export function runCommand(command, args, cwd, allowFailure = false) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
	});
	const exitCode = result.error ? null : (result.status ?? 1);
	if (!allowFailure && exitCode !== 0) {
		throw new Error(`${commandText(command, args)} failed: ${result.stderr?.trim() || result.error?.message || `exit ${exitCode}`}`);
	}
	return {
		command: commandText(command, args),
		exitCode,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function bounded(values, label) {
	const sorted = [...values].sort();
	return {
		items: sorted.slice(0, MAX_LIST_ITEMS),
		truncated: sorted.length > MAX_LIST_ITEMS,
		...(sorted.length > MAX_LIST_ITEMS ? { omitted: sorted.length - MAX_LIST_ITEMS, label } : {}),
	};
}

export function parseBranchHeader(line) {
	const value = line.replace(/^##\s*/, "").trim();
	if (!value) return { name: undefined, detached: true };
	if (/^HEAD \(no branch\)/.test(value) || /^HEAD \(detached/.test(value)) {
		return { name: undefined, detached: true };
	}
	const match = /^(.*?)(?:\.\.\.(\S+))?(?:\s+\[([^\]]+)\])?$/.exec(value);
	const name = match?.[1]?.trim() || value;
	const tracking = match?.[2];
	const divergence = {};
	for (const item of (match?.[3] ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
		const divergenceMatch = /^(ahead|behind) (\d+)$/.exec(item);
		if (divergenceMatch) divergence[divergenceMatch[1]] = Number(divergenceMatch[2]);
		else if (item === "gone") divergence.gone = true;
	}
	return {
		name,
		detached: false,
		...(tracking ? { tracking } : {}),
		...(Object.keys(divergence).length ? { divergence } : {}),
	};
}

export function parseStatusPorcelain(output) {
	const records = output.split("\0").filter(Boolean);
	const header = records.find((record) => record.startsWith("## ")) ?? "## HEAD (no branch)";
	const files = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record.startsWith("## ")) continue;
		if (record.length < 3) continue;
		const indexStatus = record[0];
		const worktreeStatus = record[1];
		const path = record.slice(3);
		if (!path) continue;
		const renamed = indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C";
		const entry = {
			path,
			indexStatus,
			worktreeStatus,
			staged: indexStatus !== " " && indexStatus !== "?",
			unstaged: worktreeStatus !== " " && worktreeStatus !== "?",
			untracked: indexStatus === "?" && worktreeStatus === "?",
			conflicted: [indexStatus, worktreeStatus].some((status) => status === "U") || ["AA", "DD"].includes(indexStatus + worktreeStatus),
		};
		if (renamed && records[index + 1] && !records[index + 1].startsWith("## ")) {
			entry.previousPath = records[index + 1];
			index += 1;
		}
		files.push(entry);
	}
	return { branch: parseBranchHeader(header), files };
}

function scalar(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
		try {
			const parsed = JSON.parse(trimmed);
			return typeof parsed === "string" ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
	return trimmed;
}

export function parseChangeset(content, file) {
	const lines = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
	const errors = [];
	if (lines[0] !== "---") return { file, packages: [], summary: "", errors: [`${file}: missing frontmatter`] };
	const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
	if (end < 0) return { file, packages: [], summary: "", errors: [`${file}: unterminated frontmatter`] };

	const packages = [];
	for (const line of lines.slice(1, end)) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const match = /^\s*(\"[^\"]+\"|'[^']+'|[^:\s]+)\s*:\s*(\S+)\s*$/.exec(line);
		if (!match) {
			errors.push(`${file}: invalid package entry: ${line.trim()}`);
			continue;
		}
		const name = scalar(match[1]);
		const type = scalar(match[2]);
		if (!name) errors.push(`${file}: invalid package name`);
		else if (!/^(major|minor|patch)$/.test(type)) errors.push(`${file}: invalid bump for ${name}: ${type}`);
		else if (packages.some((item) => item.name === name)) errors.push(`${file}: duplicate package: ${name}`);
		else packages.push({ name, type });
	}
	if (packages.length === 0) errors.push(`${file}: no package bumps found`);
	return { file, packages, summary: lines.slice(end + 1).join("\n").trim(), errors };
}

function readJson(path, errors) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

export function loadPublishablePackages(root) {
	const errors = [];
	const packages = new Map();
	const packagesRoot = join(root, "packages");
	for (const entry of readdirSync(packagesRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory() || ARCHIVED_PACKAGE_DIRS.has(entry.name)) continue;
		const directory = join(packagesRoot, entry.name);
		if (!existsSync(join(directory, "package.json"))) continue;
		const manifest = readJson(join(directory, "package.json"), errors);
		if (!manifest || typeof manifest.name !== "string") continue;
		packages.set(manifest.name, {
			directory: entry.name,
			path: relative(root, directory),
			name: manifest.name,
			version: manifest.version,
			private: manifest.private === true,
			scripts: manifest.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {},
			extension: Array.isArray(manifest.pi?.extensions),
		});
	}
	return { packages, errors };
}

function packageDirForPath(path) {
	return /^packages\/([^/]+)(?:\/|$)/.exec(path)?.[1];
}

export function assessReadiness({ worktree, changesets, affectedPackages, packageErrors = [] }) {
	const blockers = [...packageErrors];
	const warnings = [];
	if (worktree.files.length > 0) blockers.push("Working tree is not clean; commit or discard the listed changes before release.");
	if (changesets.errors.length > 0) blockers.push(...changesets.errors);
	if (changesets.pending.length === 0) blockers.push("No pending Changesets found.");
	for (const packageInfo of affectedPackages) {
		if (packageInfo.changed && packageInfo.pendingBumps.length === 0) {
			blockers.push(`${packageInfo.name} has changed files but no pending Changeset.`);
		}
	}
	if (affectedPackages.some((packageInfo) => packageInfo.unresolvedChangeset)) {
		blockers.push("A pending Changeset names a package that is not a publishable active workspace.");
	}
	if (affectedPackages.some((packageInfo) => packageInfo.nonPublishableChangeset)) {
		blockers.push("A pending Changeset names a private workspace that cannot be published.");
	}
	if (worktree.branch.detached) warnings.push("HEAD is detached; release from a named branch after confirming the intended ref.");
	if (changesets.pending.length > 0 && affectedPackages.length === 0) warnings.push("Pending Changesets do not resolve to publishable packages.");
	return {
		status: blockers.length > 0 ? "not_ready" : "ready",
		blockers,
		warnings,
		validation: "not_run",
	};
}

export function buildValidationCommands(rootManifest, affectedPackages, { hasBaseRef }) {
	const scripts = rootManifest?.scripts ?? {};
	const commands = [];
	const add = (command, reason, caveat) => commands.push({ command, reason, available: true, ...(caveat ? { caveat } : {}) });
	if (scripts.check && typeof scripts.check === "string") add("bun run check", "Run all active workspace checks and knip");
	if ((typeof scripts.check === "string" && scripts.check.includes("check:changed")) || scripts["check:changed"]) {
		add("bun run check:changed", "Check changed workspace packages, extension artifacts, and knip", hasBaseRef ? undefined : "origin/main is unavailable; the changed-workspaces fallback may check every active package");
	}
	if (scripts["changeset:check"]) add("bun run changeset:check", "Verify changed publishable packages have a Changeset", hasBaseRef ? undefined : "This repository script compares against origin/main; fetch it before relying on the result");
	for (const packageInfo of affectedPackages) {
		if (packageInfo.scripts.check && packageInfo.directory) {
			add(`bun --cwd ${packageInfo.path} run check`, `Run the affected package's check script for ${packageInfo.name}`);
		}
		if (packageInfo.scripts.build && packageInfo.extension) {
			add(`bun --cwd ${packageInfo.path} run build`, `Build the affected Pi extension package ${packageInfo.name}`);
		}
	}
	return commands.slice(0, 12);
}

function changedPackagePaths(paths, packages) {
	const byDirectory = new Map([...packages.values()].map((item) => [item.directory, item]));
	const changed = new Map();
	for (const path of paths) {
		const directory = packageDirForPath(path);
		const packageInfo = directory && byDirectory.get(directory);
		if (!packageInfo || packageInfo.private) continue;
		if (!changed.has(packageInfo.name)) changed.set(packageInfo.name, []);
		changed.get(packageInfo.name).push(path);
	}
	return changed;
}

function readPendingChangesets(root) {
	const directory = join(root, ".changeset");
	if (!existsSync(directory)) return { pending: [], errors: [".changeset directory is missing"] };
	const pending = [];
	const errors = [];
	for (const filename of readdirSync(directory).sort()) {
		if (!filename.endsWith(".md") || filename === "README.md" || filename === "aggregate-bundles.md") continue;
		const parsed = parseChangeset(readFileSync(join(directory, filename), "utf8"), `.changeset/${filename}`);
		pending.push(parsed);
		errors.push(...parsed.errors);
	}
	return { pending, errors };
}

function gitNameOnly(result) {
	return result.stdout.split("\0").filter(Boolean);
}

export function buildReport({ cwd = process.cwd(), request, run = runCommand, now = new Date() }) {
	const initial = run("git", ["rev-parse", "--show-toplevel"], cwd);
	const root = initial.stdout.trim();
	if (!root) throw new Error("Could not determine the Git repository root");
	const branchResult = run("git", ["symbolic-ref", "--short", "-q", "HEAD"], root, true);
	const headResult = run("git", ["rev-parse", "HEAD"], root, true);
	const statusResult = run("git", ["status", "--porcelain=v1", "-z", "--branch"], root);
	const parsedStatus = parseStatusPorcelain(statusResult.stdout);
	const branch = {
		...parsedStatus.branch,
		...(branchResult.stdout.trim() ? { name: branchResult.stdout.trim(), detached: false } : {}),
		commit: headResult.stdout.trim() || undefined,
	};
	const upstreamResult = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], root, true);
	if (upstreamResult.stdout.trim()) branch.tracking = upstreamResult.stdout.trim();
	const baseResult = run("git", ["rev-parse", "--verify", "origin/main"], root, true);
	const baseRef = baseResult.exitCode === 0 ? "origin/main" : undefined;
	const branchFilesResult = baseRef
			? run("git", ["diff", "--name-only", "-z", `${baseRef}...HEAD`], root, true)
		: { stdout: "", stderr: "", exitCode: null, command: "git diff --name-only -z origin/main...HEAD" };
	const worktreePaths = parsedStatus.files.map((file) => file.path);
	const branchPaths = gitNameOnly(branchFilesResult);
	const packageData = loadPublishablePackages(root);
	const changesets = readPendingChangesets(root);
	const changed = changedPackagePaths([...branchPaths, ...worktreePaths], packageData.packages);
	const bumps = new Map();
	const changesetFiles = new Map();
	for (const changeset of changesets.pending) {
		for (const bump of changeset.packages) {
			if (!bumps.has(bump.name)) bumps.set(bump.name, []);
			bumps.get(bump.name).push(bump.type);
			if (!changesetFiles.has(bump.name)) changesetFiles.set(bump.name, []);
			changesetFiles.get(bump.name).push(changeset.file);
		}
	}
	const names = new Set([...changed.keys(), ...bumps.keys()]);
	const affectedPackages = [...names].sort().map((name) => {
		const manifest = packageData.packages.get(name);
		const packagePaths = changed.get(name) ?? [];
		return {
			name,
				...(manifest ? { directory: manifest.directory, path: manifest.path, version: manifest.version, scripts: manifest.scripts, extension: manifest.extension } : {}),
			publishable: Boolean(manifest && !manifest.private),
			changed: packagePaths.length > 0,
			changedFiles: bounded(packagePaths, `${name} changed files`),
			pendingBumps: bumps.get(name) ?? [],
			changesets: changesetFiles.get(name) ?? [],
			unresolvedChangeset: !manifest && bumps.has(name),
			nonPublishableChangeset: Boolean(manifest?.private && bumps.has(name)),
		};
	});
	const readiness = assessReadiness({ worktree: { branch, files: parsedStatus.files }, changesets, affectedPackages, packageErrors: packageData.errors });
	const rootManifest = readJson(join(root, "package.json"), packageData.errors) ?? {};
	const validationCommands = buildValidationCommands(rootManifest, affectedPackages.filter((item) => item.publishable), { hasBaseRef: Boolean(baseRef) });
	return {
		schemaVersion: 1,
		request,
		generatedAt: now.toISOString(),
		repository: {
			root,
			cwd: resolve(cwd),
			branch,
			comparison: { base: baseRef ?? null, branchChangesIncluded: Boolean(baseRef), workingTreeChangesIncluded: true },
		},
		worktree: {
			clean: parsedStatus.files.length === 0,
			staged: parsedStatus.files.filter((file) => file.staged).length,
			unstaged: parsedStatus.files.filter((file) => file.unstaged).length,
			untracked: parsedStatus.files.filter((file) => file.untracked).length,
			conflicted: parsedStatus.files.filter((file) => file.conflicted).length,
			files: parsedStatus.files,
		},
		changesets: {
			pending: changesets.pending.map(({ file, packages, summary, errors }) => ({ file, packages, summary, ...(errors.length ? { errors } : {}) })),
			count: changesets.pending.length,
			errors: changesets.errors,
		},
		affectedPublishablePackages: affectedPackages.filter((item) => item.publishable),
		validationCommands,
		readiness,
		evidence: {
			commands: [initial, branchResult, headResult, statusResult, upstreamResult, baseResult, branchPaths.length ? branchFilesResult : undefined]
				.filter(Boolean)
				.map(({ command, exitCode, stderr }) => ({ command, exitCode, ...(stderr.trim() ? { stderr: stderr.trim().slice(0, 500) } : {}) })),
			packageManifestCount: packageData.packages.size,
			branchChangedFileCount: branchPaths.length,
		},
	};
}

function main() {
	const request = process.argv.slice(2).join(" ").trim();
	if (!request) throw new Error("release_readiness requires one non-empty string request");
	process.stdout.write(`${JSON.stringify(buildReport({ request }))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
