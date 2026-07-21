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

test("adds command guidance without changing the transcript", () => {
	const conversation = {
		text: "[User]\nContinue the API work",
	};

	expect(
		buildRescuePrompt(conversation, "focus on the open blocker"),
	).toContain("Additional focus: focus on the open blocker");
});
