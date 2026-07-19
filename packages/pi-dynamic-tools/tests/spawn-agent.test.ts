import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildPiArgs,
	buildReviewerMessage,
	detectReviewContext,
	parseSpawnAgentRequest,
	prepareSpawn,
} from "../examples/spawn-agent/spawn-agent.mjs";

function git(cwd: string, args: string[]) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("bundled spawn_agent", () => {
	let repo: string;

	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "pi-spawn-agent-"));
		git(repo, ["init", "-b", "dev"]);
		git(repo, ["config", "user.name", "Test"]);
		git(repo, ["config", "user.email", "test@example.com"]);
		writeFileSync(join(repo, "base.txt"), "base\n");
		git(repo, ["add", "base.txt"]);
		git(repo, ["commit", "-m", "base"]);
		git(repo, ["checkout", "-q", "-b", "feature"]);
		writeFileSync(join(repo, "base.txt"), "changed\n");
		writeFileSync(join(repo, "new.txt"), "new\n");
	});

	afterAll(() => rmSync(repo, { recursive: true, force: true }));

	test("accepts the Codex-shaped role and message with optional cwd", () => {
		expect(
			parseSpawnAgentRequest(
				JSON.stringify({
					agent_type: "reviewer",
					message: "Review the change.",
					cwd: "../repo",
				}),
			),
		).toEqual({
			agent_type: "reviewer",
			message: "Review the change.",
			cwd: "../repo",
		});
		expect(() =>
			parseSpawnAgentRequest(
				JSON.stringify({ agent_type: "worker", message: "Implement it." }),
			),
		).toThrow('agent_type must be "explorer" or "reviewer"');
	});

	test("maps explorer and reviewer to fixed models with appended prompts", () => {
		const explorer = buildPiArgs(
			{ agent_type: "explorer", message: "Find it." },
			"Find it.",
		);
		const reviewer = buildPiArgs(
			{ agent_type: "reviewer", message: "Review it." },
			"Review base:\nInstructions:\nReview it.",
		);
		expect(explorer).toContain("openai-codex/gpt-5.6-terra");
		expect(explorer).toContain("low");
		expect(reviewer).toContain("openai-codex/gpt-5.6-luna");
		expect(reviewer).toContain("medium");
		expect(explorer).toContain("--append-system-prompt");
		expect(explorer).not.toContain("--system-prompt");
		expect(explorer).not.toContain("--no-context-files");
		expect(explorer).toContain("--no-skills");
	});

	test("uses the review extension rubric", () => {
		const bundled = readFileSync(
			new URL("../examples/spawn-agent/reviewer.prompt.md", import.meta.url),
			"utf8",
		);
		const reviewExtension = readFileSync(
			new URL("../../pi-subagent-review/review.prompt.md", import.meta.url),
			"utf8",
		);
		expect(bundled).toBe(reviewExtension);
	});

	test("documents the example as inactive reference material", () => {
		const documentation = readFileSync(
			new URL("../DYNAMIC-TOOLS.md", import.meta.url),
			"utf8",
		);
		expect(documentation).toContain(
			"Installing the package does not register or enable them.",
		);
		expect(documentation).toContain(
			"It does not control, validate, or transform command output.",
		);
		expect(documentation).toContain(
			"Relative entries inside `args` are not rewritten",
		);
		expect(documentation).not.toContain("An agent can");
	});

	test("detects the review base and builds explicit review instructions", () => {
		const review = detectReviewContext(repo);
		expect(review.scope).toBe("base-diff");
		expect(review.baseBranch).toBe("dev");
		expect(review.mergeBase).toMatch(/^[0-9a-f]{40}$/);
		expect(review.status).toContain("base.txt");
		expect(review.status).toContain("new.txt");

		const message = buildReviewerMessage(review, "Focus on data loss.");
		expect(message).toContain("Review base:");
		expect(message).toContain(`Base branch: dev`);
		expect(message).toContain(`git diff ${review.mergeBase}`);
		expect(message).toContain("Instructions:\nFocus on data loss.");

		const prepared = prepareSpawn(
			{
				agent_type: "reviewer",
				message: "Focus on data loss.",
				cwd: repo,
			},
			"/",
		);
		expect(prepared.cwd).toBe(repo);
		expect(prepared.message).toBe(message);
	});
});
