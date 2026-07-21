import { expect, test } from "bun:test";
import { buildRescueConversation, buildRescuePrompt } from "../src/summary.js";

test("keeps user and assistant text while omitting tool traffic", () => {
	const result = buildRescueConversation(
		[
			{ role: "user", content: "Fix the migration", timestamp: 1 },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will inspect the schema." },
					{
						type: "toolCall",
						id: "call-1",
						name: "read",
						arguments: { path: "db.ts" },
					},
				],
				api: "test",
				provider: "test",
				model: "test",
				stopReason: "toolUse",
				timestamp: 2,
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "secret tool output" }],
				isError: false,
				timestamp: 3,
			},
			{
				role: "custom",
				customType: "note",
				content: "Keep the migration reversible",
				display: true,
				timestamp: 4,
			},
		] as never,
		undefined,
	);

	expect(result.text).toContain("Fix the migration");
	expect(result.text).toContain("I will inspect the schema.");
	expect(result.text).toContain("Keep the migration reversible");
	expect(result.text).not.toContain("read");
	expect(result.text).not.toContain("secret tool output");
});

test("keeps the complete text supplied to rescue", () => {
	const result = buildRescueConversation(
		[{ role: "user", content: "x".repeat(4000), timestamp: 1 }] as never,
		"old summary",
	);

	expect(result.text).toContain("x".repeat(4000));
});

test("trims oldest conversation content to the requested token budget", () => {
	const result = buildRescueConversation(
		[
			{ role: "user", content: "old context ".repeat(100), timestamp: 1 },
			{ role: "assistant", content: "latest decision", timestamp: 2 },
		] as never,
		undefined,
		80,
	);

	expect(result.text).toContain("[Earlier conversation omitted]");
	expect(result.text).toContain("latest decision");
	expect(result.text).not.toContain("old context");
});

test("prioritizes recent context when a previous summary wrapper cannot fit", () => {
	const result = buildRescueConversation(
		[
			{ role: "user", content: "recent decision", timestamp: 1 },
			{ role: "assistant", content: "latest next step", timestamp: 2 },
		] as never,
		"old summary",
		20,
	);

	expect(result.text).toContain("latest");
	expect(result.text).not.toContain("old summary");
	expect(result.text.length).toBeLessThanOrEqual(80);
});

test("preserves source labels for extension and summary messages", () => {
	const result = buildRescueConversation(
		[
			{
				role: "custom",
				customType: "note",
				content: "extension context",
				display: true,
				timestamp: 1,
			},
			{
				role: "branchSummary",
				summary: "branch context",
				fromId: "branch-1",
				timestamp: 2,
			},
			{
				role: "compactionSummary",
				summary: "compacted context",
				tokensBefore: 100,
				timestamp: 3,
			},
		] as never,
		undefined,
	);

	expect(result.text).toContain("[Extension (note)]");
	expect(result.text).toContain("[Branch summary]");
	expect(result.text).toContain("[Previous compaction summary]");
});

test("adds command guidance without changing the transcript", () => {
	const conversation = {
		text: "[User]\nContinue the API work",
	};

	expect(
		buildRescuePrompt(conversation, "focus on the open blocker"),
	).toContain("Additional focus: focus on the open blocker");
});
