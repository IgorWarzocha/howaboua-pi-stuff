import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	formatValidationFeedback,
	runExistingChecks,
} from "../src/validation.js";

describe("validation feedback", () => {
	test("returns command identity and actionable failure output", () => {
		expect(
			formatValidationFeedback({
				passed: false,
				results: [
					{
						command: "bun run check",
						passed: false,
						output: "src/router.ts: type error",
					},
				],
			}),
		).toBe("failed: bun run check\nsrc/router.ts: type error");
	});

	test("runs the nearest existing package check", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "auto-hardening-"));
		const packageDir = path.join(root, "packages", "feature");
		await fs.mkdir(path.join(packageDir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(root, "package.json"),
			JSON.stringify({ packageManager: "bun@1.3.14" }),
		);
		await fs.writeFile(path.join(root, "bun.lock"), "");
		await fs.writeFile(
			path.join(packageDir, "package.json"),
			JSON.stringify({ scripts: { check: "test-command" } }),
		);

		const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
		const pi = {
			exec: async (
				command: string,
				args: string[],
				options?: { cwd?: string },
			) => {
				calls.push({ command, args, cwd: options?.cwd });
				return { stdout: "", stderr: "", code: 0, killed: false };
			},
		} as unknown as ExtensionAPI;

		try {
			const result = await runExistingChecks(pi, root, [
				"packages/feature/src/index.ts",
			]);
			expect(result.passed).toBe(true);
			expect(calls).toEqual([
				{ command: "git", args: ["diff", "--check"], cwd: root },
				{ command: "bun", args: ["run", "check"], cwd: packageDir },
			]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
