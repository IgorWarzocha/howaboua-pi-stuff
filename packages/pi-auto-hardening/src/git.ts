import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	EXCLUDED_PATH_SEGMENTS,
	MAX_CANDIDATES_IN_PROMPT,
	SOURCE_EXTENSIONS,
} from "./constants.js";
import type {
	BaseCandidate,
	ChangedFileFact,
	HardeningContext,
} from "./types.js";

async function runGit(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
	timeout = 15_000,
) {
	return pi.exec("git", args, { cwd, timeout });
}

async function gitString(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
): Promise<string> {
	const result = await runGit(pi, cwd, args);
	if (result.code !== 0) {
		throw new Error(
			result.stderr.trim() ||
				result.stdout.trim() ||
				`git ${args.join(" ")} failed with exit code ${result.code}`,
		);
	}
	return result.stdout.trim();
}

async function gitStringOrUndefined(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
): Promise<string | undefined> {
	const result = await runGit(pi, cwd, args);
	if (result.code !== 0) return undefined;
	return result.stdout.trim() || undefined;
}

export function selectClosestBase(
	candidates: BaseCandidate[],
	currentBranch: string,
): BaseCandidate | undefined {
	const eligible =
		currentBranch === "dev" || currentBranch === "develop"
			? candidates.filter((candidate) => candidate.kind === "trunk")
			: candidates;

	return [...eligible].sort((left, right) => {
		if (left.distance !== right.distance) return left.distance - right.distance;
		if (left.kind !== right.kind) return left.kind === "trunk" ? -1 : 1;
		return left.ref.localeCompare(right.ref);
	})[0];
}

async function resolveBaseCandidates(
	pi: ExtensionAPI,
	repoRoot: string,
): Promise<BaseCandidate[]> {
	const refs: Array<Pick<BaseCandidate, "kind" | "label" | "ref">> = [
		{ ref: "refs/heads/dev", label: "dev", kind: "integration" },
		{
			ref: "refs/remotes/origin/dev",
			label: "origin/dev",
			kind: "integration",
		},
		{ ref: "refs/heads/develop", label: "develop", kind: "integration" },
		{
			ref: "refs/remotes/origin/develop",
			label: "origin/develop",
			kind: "integration",
		},
		{ ref: "refs/heads/main", label: "main", kind: "trunk" },
		{
			ref: "refs/remotes/origin/main",
			label: "origin/main",
			kind: "trunk",
		},
		{ ref: "refs/heads/master", label: "master", kind: "trunk" },
		{
			ref: "refs/remotes/origin/master",
			label: "origin/master",
			kind: "trunk",
		},
	];
	const candidates: BaseCandidate[] = [];

	for (const candidate of refs) {
		const objectName = await gitStringOrUndefined(pi, repoRoot, [
			"rev-parse",
			"--verify",
			"--quiet",
			candidate.ref,
		]);
		if (!objectName) continue;
		const mergeBase = await gitStringOrUndefined(pi, repoRoot, [
			"merge-base",
			candidate.ref,
			"HEAD",
		]);
		if (!mergeBase) continue;
		const distanceText = await gitStringOrUndefined(pi, repoRoot, [
			"rev-list",
			"--count",
			`${mergeBase}..HEAD`,
		]);
		const distance = Number.parseInt(distanceText ?? "", 10);
		if (!Number.isFinite(distance)) continue;
		candidates.push({ ...candidate, mergeBase, distance });
	}

	return candidates;
}

export async function findRepoRoot(
	pi: ExtensionAPI,
	cwd: string,
): Promise<string | undefined> {
	return gitStringOrUndefined(pi, cwd, ["rev-parse", "--show-toplevel"]);
}

async function listUntrackedFiles(
	pi: ExtensionAPI,
	repoRoot: string,
): Promise<string[]> {
	const output = await gitStringOrUndefined(pi, repoRoot, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
	]);
	return output ? output.split("\0").filter(Boolean) : [];
}

export async function fingerprintRepository(
	pi: ExtensionAPI,
	repoRoot: string,
): Promise<string> {
	const [head, status, trackedDiff, stagedDiff, untracked] = await Promise.all([
		gitString(pi, repoRoot, ["rev-parse", "HEAD"]),
		gitString(pi, repoRoot, [
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
		]),
		gitString(pi, repoRoot, ["diff", "--binary", "HEAD"]),
		gitString(pi, repoRoot, ["diff", "--binary", "--cached", "HEAD"]),
		listUntrackedFiles(pi, repoRoot),
	]);
	const hash = createHash("sha256");
	hash.update(head);
	hash.update("\0");
	hash.update(status);
	hash.update("\0");
	hash.update(trackedDiff);
	hash.update("\0");
	hash.update(stagedDiff);

	for (const relativePath of untracked.sort()) {
		hash.update("\0");
		hash.update(relativePath);
		try {
			hash.update(await fs.readFile(path.join(repoRoot, relativePath)));
		} catch {
			hash.update("<unreadable>");
		}
	}

	return hash.digest("hex");
}

function isSourcePath(relativePath: string): boolean {
	const segments = relativePath.split(/[\\/]/);
	if (segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment)))
		return false;
	return SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function parseNumstat(output: string): Map<string, [number, number]> {
	const stats = new Map<string, [number, number]>();
	for (const entry of output.split("\0")) {
		if (!entry) continue;
		const [addedText, deletedText, filePath] = entry.split("\t");
		if (!filePath) continue;
		const additions = Number.parseInt(addedText ?? "", 10);
		const deletions = Number.parseInt(deletedText ?? "", 10);
		stats.set(filePath, [
			Number.isFinite(additions) ? additions : 0,
			Number.isFinite(deletions) ? deletions : 0,
		]);
	}
	return stats;
}

async function inspectChangedFile(
	pi: ExtensionAPI,
	repoRoot: string,
	mergeBase: string,
	relativePath: string,
	stats: [number, number],
	untracked: boolean,
): Promise<ChangedFileFact | undefined> {
	let content: string;
	try {
		content = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
	} catch {
		return undefined;
	}
	if (content.includes("\0")) return undefined;

	let hunks = untracked ? 1 : 0;
	if (!untracked) {
		const diff = await runGit(pi, repoRoot, [
			"diff",
			"--unified=0",
			mergeBase,
			"--",
			relativePath,
		]);
		if (diff.code === 0) hunks = (diff.stdout.match(/^@@/gm) ?? []).length;
	}

	const moduleStatements = (
		content.match(
			/^\s*(?:import\b|export\b|(?:const|let|var)\s+\w+\s*=\s*require\s*\(|(?:from|use|mod)\s+\S+)/gm,
		) ?? []
	).length;

	return {
		path: relativePath,
		additions: stats[0],
		deletions: stats[1],
		lines: content ? content.split("\n").length : 0,
		hunks,
		moduleStatements,
		untracked,
	};
}

function candidateScore(candidate: ChangedFileFact): number {
	return (
		candidate.additions +
		candidate.deletions +
		candidate.hunks * 20 +
		Math.min(candidate.lines, 2_000) / 10 +
		candidate.moduleStatements * 2
	);
}

export async function inspectHardeningContext(
	pi: ExtensionAPI,
	cwd: string,
): Promise<HardeningContext | undefined> {
	const repoRoot = await findRepoRoot(pi, cwd);
	if (!repoRoot) return undefined;
	const currentBranch = await gitString(pi, repoRoot, [
		"branch",
		"--show-current",
	]);
	if (!currentBranch || currentBranch === "main" || currentBranch === "master")
		return undefined;

	const base = selectClosestBase(
		await resolveBaseCandidates(pi, repoRoot),
		currentBranch,
	);
	if (!base) return undefined;

	const [nameOutput, numstatOutput, untrackedFiles, status, fingerprint] =
		await Promise.all([
			gitString(pi, repoRoot, [
				"diff",
				"--name-only",
				"--no-renames",
				"-z",
				base.mergeBase,
			]),
			gitString(pi, repoRoot, [
				"diff",
				"--numstat",
				"--no-renames",
				"-z",
				base.mergeBase,
			]),
			listUntrackedFiles(pi, repoRoot),
			gitString(pi, repoRoot, ["status", "--short", "--untracked-files=all"]),
			fingerprintRepository(pi, repoRoot),
		]);
	const trackedFiles = nameOutput.split("\0").filter(Boolean);
	const changedFiles = [
		...new Set([...trackedFiles, ...untrackedFiles]),
	].sort();
	const sourceFiles = changedFiles.filter(isSourcePath);
	if (sourceFiles.length === 0) return undefined;
	const stats = parseNumstat(numstatOutput);
	const untrackedSet = new Set(untrackedFiles);
	const inspected = await Promise.all(
		sourceFiles.map((relativePath) =>
			inspectChangedFile(
				pi,
				repoRoot,
				base.mergeBase,
				relativePath,
				stats.get(relativePath) ?? [0, 0],
				untrackedSet.has(relativePath),
			),
		),
	);
	const candidates = inspected
		.filter((candidate): candidate is ChangedFileFact => Boolean(candidate))
		.sort((left, right) => candidateScore(right) - candidateScore(left))
		.slice(0, MAX_CANDIDATES_IN_PROMPT);
	if (candidates.length === 0) return undefined;

	return {
		repoRoot,
		currentBranch,
		base,
		status,
		fingerprint,
		changedFiles,
		candidates,
	};
}
