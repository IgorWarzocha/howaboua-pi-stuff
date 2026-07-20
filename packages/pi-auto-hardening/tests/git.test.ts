import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inspectHardeningContext, selectClosestBase } from "../src/git.js";
import type { BaseCandidate } from "../src/types.js";

const execFileAsync = promisify(execFile);

const trunk: BaseCandidate = {
	ref: "refs/heads/main",
	label: "main",
	kind: "trunk",
	mergeBase: "trunk-base",
	distance: 5,
};
const integration: BaseCandidate = {
	ref: "refs/heads/dev",
	label: "dev",
	kind: "integration",
	mergeBase: "dev-base",
	distance: 2,
};

describe("selectClosestBase", () => {
	test("uses the closer integration layer for a feature branch", () => {
		expect(selectClosestBase([trunk, integration], "feature/auth")).toEqual(
			integration,
		);
	});

	test("uses trunk for the integration branch", () => {
		expect(selectClosestBase([trunk, integration], "dev")).toEqual(trunk);
	});

	test("prefers trunk when merge-base distance ties", () => {
		expect(
			selectClosestBase(
				[trunk, { ...integration, distance: trunk.distance }],
				"feature/from-main",
			),
		).toEqual(trunk);
	});
});

test("inspects the active feature layer and source candidates", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "auto-hardening-git-"));
	const git = (args: string[]) => execFileAsync("git", args, { cwd: root });
	try {
		await git(["init", "-b", "main"]);
		await git(["config", "user.email", "test@example.com"]);
		await git(["config", "user.name", "Test"]);
		await fs.writeFile(
			path.join(root, "app.ts"),
			"export const root = true;\n",
		);
		await git(["add", "app.ts"]);
		await git(["commit", "-m", "main"]);
		await git(["switch", "-c", "dev"]);
		await fs.appendFile(
			path.join(root, "app.ts"),
			"export const dev = true;\n",
		);
		await git(["commit", "-am", "dev"]);
		await git(["switch", "-c", "feature/work"]);
		await fs.appendFile(
			path.join(root, "app.ts"),
			"export const feature = true;\n",
		);

		const pi = {
			exec: async (
				command: string,
				args: string[],
				options?: { cwd?: string },
			) => {
				try {
					const result = await execFileAsync(command, args, {
						cwd: options?.cwd,
					});
					return {
						stdout: result.stdout,
						stderr: result.stderr,
						code: 0,
						killed: false,
					};
				} catch (error) {
					const failed = error as Error & {
						code?: number;
						stdout?: string;
						stderr?: string;
					};
					return {
						stdout: failed.stdout ?? "",
						stderr: failed.stderr ?? failed.message,
						code: failed.code ?? 1,
						killed: false,
					};
				}
			},
		} as unknown as ExtensionAPI;

		const context = await inspectHardeningContext(pi, root);
		expect(context?.base.label).toBe("dev");
		expect(context?.changedFiles).toEqual(["app.ts"]);
		expect(context?.candidates[0]).toMatchObject({
			path: "app.ts",
			additions: 1,
			deletions: 0,
			untracked: false,
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
