import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ReviewContext } from "./types.js";

async function runGit(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
	timeout = 10_000,
) {
	return pi.exec("git", args, { cwd, timeout });
}

async function gitString(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
	timeout = 10_000,
): Promise<string> {
	const result = await runGit(pi, cwd, args, timeout);
	if (result.code !== 0) {
		const command = `git ${args.join(" ")}`;
		const message =
			result.stderr.trim() ||
			result.stdout.trim() ||
			`${command} failed with exit code ${result.code}`;
		throw new Error(message);
	}
	return result.stdout.trim();
}

async function hasLocalBranch(
	pi: ExtensionAPI,
	cwd: string,
	branch: "main" | "master" | "dev",
): Promise<boolean> {
	const refResult = await runGit(pi, cwd, [
		"rev-parse",
		"--verify",
		"--quiet",
		`refs/heads/${branch}`,
	]);
	if (refResult.code !== 0) return false;

	const objectName = refResult.stdout.trim();
	if (!objectName) return false;
	const commitResult = await runGit(pi, cwd, [
		"cat-file",
		"-e",
		`${objectName}^{commit}`,
	]);
	return commitResult.code === 0;
}

async function hasLocalDevBranch(
	pi: ExtensionAPI,
	cwd: string,
): Promise<boolean> {
	return hasLocalBranch(pi, cwd, "dev");
}

async function hasTrackedChangesAgainst(
	pi: ExtensionAPI,
	cwd: string,
	revision: string,
): Promise<boolean> {
	const result = await runGit(pi, cwd, ["diff", "--quiet", revision]);
	if (result.code === 0) return false;
	if (result.code === 1) return true;
	throw new Error(
		result.stderr.trim() ||
			`git diff --quiet ${revision} failed with exit code ${result.code}`,
	);
}

async function gitStringOrUndefined(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
	timeout = 10_000,
): Promise<string | undefined> {
	const result = await runGit(pi, cwd, args, timeout);
	if (result.code !== 0) return undefined;
	return result.stdout.trim();
}

export async function detectReviewContext(
	pi: ExtensionAPI,
	cwd: string,
): Promise<ReviewContext> {
	const repoRoot = await gitString(pi, cwd, ["rev-parse", "--show-toplevel"]);
	const currentBranch = await gitString(pi, repoRoot, [
		"branch",
		"--show-current",
	]);
	const [hasDev, hasMain, hasMaster] = await Promise.all([
		hasLocalDevBranch(pi, repoRoot),
		hasLocalBranch(pi, repoRoot, "main"),
		hasLocalBranch(pi, repoRoot, "master"),
	]);

	let baseBranch: "main" | "master" | "dev" | undefined;
	if (currentBranch === "dev") {
		if (hasMain) baseBranch = "main";
		else if (hasMaster) baseBranch = "master";
	} else if (currentBranch !== "main" && currentBranch !== "master") {
		if (hasDev) baseBranch = "dev";
		else if (hasMain) baseBranch = "main";
		else if (hasMaster) baseBranch = "master";
	} else {
		if (hasDev) baseBranch = "dev";
		else if (currentBranch === "main" && hasMaster) baseBranch = "master";
		else if (currentBranch === "master" && hasMain) baseBranch = "main";
		else baseBranch = currentBranch as "main" | "master";
	}

	const currentRef =
		currentBranch ||
		(await gitString(pi, repoRoot, ["rev-parse", "--short", "HEAD"]));
	const status = await gitString(pi, repoRoot, [
		"status",
		"--short",
		"--untracked-files=all",
	]);

	if (!baseBranch) {
		return {
			repoRoot,
			currentRef,
			scope: "current-state",
			status,
			hasTrackedChanges: false,
			hasAnyChanges: true,
		};
	}

	const baseBranchRef = `refs/heads/${baseBranch}`;
	const mergeBase = await gitStringOrUndefined(pi, repoRoot, [
		"merge-base",
		baseBranchRef,
		"HEAD",
	]);
	if (!mergeBase) {
		return {
			repoRoot,
			currentRef,
			scope: "current-state",
			baseBranch,
			status,
			hasTrackedChanges: false,
			hasAnyChanges: true,
		};
	}

	const baseTip = await gitStringOrUndefined(pi, repoRoot, [
		"rev-parse",
		"--short",
		baseBranchRef,
	]);
	const recentBaseCommits = await gitStringOrUndefined(pi, repoRoot, [
		"log",
		"--oneline",
		"--decorate",
		"-n",
		"8",
		baseBranchRef,
	]);
	const hasTrackedChanges = await hasTrackedChangesAgainst(
		pi,
		repoRoot,
		mergeBase,
	);
	const hasAnyChanges = hasTrackedChanges || status.length > 0;
	const latestCommit = await gitStringOrUndefined(pi, repoRoot, [
		"rev-parse",
		"--short",
		"HEAD",
	]);
	const scope = hasAnyChanges ? "base-diff" : "latest-commit";

	return {
		repoRoot,
		currentRef,
		scope,
		baseBranch,
		mergeBase,
		baseTip,
		latestCommit,
		status,
		recentBaseCommits,
		hasTrackedChanges,
		hasAnyChanges: hasAnyChanges || Boolean(latestCommit),
	};
}
