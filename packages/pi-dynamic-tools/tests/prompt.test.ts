import { describe, expect, test } from "bun:test";
import { EXEC_DESCRIPTION, injectDynamicToolsPrompt } from "../src/prompt.js";
import type { DynamicToolDefinition } from "../src/types.js";

function tool(
	name: string,
	deferLoading: boolean,
	usage = `await tools.${name}(input)`,
): DynamicToolDefinition {
	return {
		name,
		usage,
		description: "This detail stays on demand.",
		output: "Plain text.",
		deferLoading,
		command: name,
		args: [],
		input: "arg",
		sourcePath: `${name}.toml`,
	};
}

describe("dynamic tool prompt tiers", () => {
	test("keeps exec stable regardless of configured tools", () => {
		expect(EXEC_DESCRIPTION).not.toContain("common_tool");
		expect(EXEC_DESCRIPTION).toContain("ALL_TOOLS");
	});

	test("injects documentation and promoted forms before runtime context", () => {
		const prompt = injectDynamicToolsPrompt(
			"Instructions\n\nCurrent shell: /bin/bash\nCurrent date: 2026-07-11",
			[tool("subagent", false, "await tools.subagent(task)")],
			"/package/DYNAMIC-TOOLS.md",
		);
		expect(prompt).toBe(
			"Instructions\n\nDynamic tools documentation: read /package/DYNAMIC-TOOLS.md before adding, changing, or answering questions about dynamic tools.\nPrefer a dynamic tool over a Pi extension for a command-backed capability.\nDynamic tools available in exec:\n- subagent: await tools.subagent(task)\nCurrent shell: /bin/bash\nCurrent date: 2026-07-11",
		);
		expect(
			injectDynamicToolsPrompt(
				prompt,
				[tool("subagent", false, "await tools.subagent(task)")],
				"/package/DYNAMIC-TOOLS.md",
			),
		).toBe(prompt);
	});
});
