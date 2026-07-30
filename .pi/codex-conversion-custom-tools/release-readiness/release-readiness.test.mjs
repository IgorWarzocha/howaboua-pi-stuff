import assert from "node:assert/strict";
import test from "node:test";
import {
	assessReadiness,
	buildValidationCommands,
	parseBranchHeader,
	parseChangeset,
	parseStatusPorcelain,
} from "./release-readiness.mjs";

test("parses branch tracking and divergence without losing detached state", () => {
	assert.deepEqual(parseBranchHeader("## release...origin/main [ahead 2, behind 1]"), {
		name: "release",
		detached: false,
		tracking: "origin/main",
		divergence: { ahead: 2, behind: 1 },
	});
	assert.deepEqual(parseBranchHeader("## HEAD (no branch)"), { name: undefined, detached: true });
});

test("parses porcelain records at the staged, untracked, rename, and conflict boundaries", () => {
	const parsed = parseStatusPorcelain([
		"## feature...origin/main [ahead 1]",
		"M  staged.ts",
		" M edited.ts",
		"?? new.ts",
		"UU conflict.ts",
		"R  renamed.ts",
		"old.ts",
		"",
	].join("\0"));
	assert.equal(parsed.files.length, 5);
	assert.equal(parsed.files[0].staged, true);
	assert.equal(parsed.files[1].unstaged, true);
	assert.equal(parsed.files[2].untracked, true);
	assert.equal(parsed.files[3].conflicted, true);
	assert.deepEqual(parsed.files[4].previousPath, "old.ts");
});

test("parses scoped Changeset names and reports malformed frontmatter", () => {
	const valid = parseChangeset(
		'---\n"@scope/pkg": patch\nother: minor\n---\n\nAdd the release behavior\n',
		".changeset/release.md",
	);
	assert.deepEqual(valid.packages, [
		{ name: "@scope/pkg", type: "patch" },
		{ name: "other", type: "minor" },
	]);
	assert.equal(valid.summary, "Add the release behavior");
	assert.deepEqual(parseChangeset("---\nnot a package entry\n---\n", "bad.md").errors, [
		"bad.md: invalid package entry: not a package entry",
		"bad.md: no package bumps found",
	]);
});

test("readiness blocks dirty or uncovered releases and exposes available checks", () => {
	const packageInfo = {
		name: "@scope/pkg",
		directory: "pkg",
		path: "packages/pkg",
		scripts: { check: "bun test" },
		changed: true,
		pendingBumps: [],
		publishable: true,
	};
	const readiness = assessReadiness({
		worktree: { branch: { detached: false }, files: [{ path: "packages/pkg/index.ts" }] },
		changesets: { pending: [], errors: [] },
		affectedPackages: [packageInfo],
	});
	assert.equal(readiness.status, "not_ready");
	assert.match(readiness.blockers.join("\n"), /not clean|No pending Changesets|no pending Changeset/);
	const commands = buildValidationCommands(
		{ scripts: { check: "...", "check:changed": "...", "changeset:check": "..." } },
		[packageInfo],
		{ hasBaseRef: true },
	);
	assert.deepEqual(commands.map((command) => command.command), [
		"bun run check",
		"bun run check:changed",
		"bun run changeset:check",
		"bun --cwd packages/pkg run check",
	]);
});
