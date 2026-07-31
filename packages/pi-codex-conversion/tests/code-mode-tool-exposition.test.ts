import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCodeModeToolsPrompt,
	injectCodeModeToolsPrompt,
	replaceCodeModeToolsPrompt,
} from "../src/tools/code-mode/custom-tool-prompt.ts";
import { scopeAllToolsToDeferredCustom } from "../src/tools/code-mode/host-client.ts";
import { SharedCodeModeRuntime } from "../src/tools/code-mode/shared-runtime.ts";
import type {
	CodeModeToolDefinition,
	CustomToolDefinition,
	ProgrammaticCodeModeToolDefinition,
} from "../src/tools/code-mode/types.ts";

const bundled: ProgrammaticCodeModeToolDefinition = {
	name: "exec_command",
	usage: "await tools.exec_command({ cmd })",
	description: "Run command",
	deferLoading: false,
	kind: "function",
	inputSchema: { type: "object" },
	async invoke() {
		return "";
	},
};

function customTool(
	name: string,
	deferLoading: boolean,
): CustomToolDefinition {
	return {
		name,
		usage: `await tools.${name}(input)`,
		description: `${name} help`,
		deferLoading,
		command: name,
		args: [],
		input: "arg",
		sourcePath: `/${name}.toml`,
	};
}

test("Code Mode separates bundled, promoted custom, and deferred custom exposition", () => {
	const promoted = customTool("promoted_tool", false);
	const deferred = customTool("deferred_tool", true);
	const tools: CodeModeToolDefinition[] = [deferred, bundled, promoted];
	const section = buildCodeModeToolsPrompt(tools, "/custom-tools.md");

	assert.match(section, /Tools available in exec:\n- await tools\.exec_command/);
	assert.match(section, /Configured custom tools:\n- await tools\.promoted_tool/);
	assert.doesNotMatch(section, /await tools\.deferred_tool/);
	assert.match(section, /Deferred custom tools: find by name in ALL_TOOLS/);
	assert.match(
		section,
		/To create or edit a custom tool, read \/custom-tools\.md; do not read Pi docs\nNever read that file to discover or call tools/,
	);

	const basePrompt = "Base\nCurrent shell: /bin/bash";
	const withoutCustom = injectCodeModeToolsPrompt(basePrompt, [bundled], "/custom-tools.md");
	assert.match(withoutCustom, /Tools available in exec:/);
	assert.doesNotMatch(withoutCustom, /Configured custom tools|ALL_TOOLS/);
	assert.match(withoutCustom, /To create or edit a custom tool, read \/custom-tools\.md; do not read Pi docs/);
	assert.match(withoutCustom, /Never read that file to discover or call tools/);
	assert.equal(
		injectCodeModeToolsPrompt(withoutCustom, [bundled], "/custom-tools.md"),
		withoutCustom,
	);

	const withCustom = injectCodeModeToolsPrompt(withoutCustom, tools, "/custom-tools.md");
	assert.equal(withCustom.match(/Tools available in exec:/g)?.length, 1);
	assert.match(withCustom, /Configured custom tools:\n- await tools\.promoted_tool/);
	assert.match(withCustom, /Deferred custom tools: find by name in ALL_TOOLS/);
	assert.match(withCustom, /To create or edit a custom tool, read/);
	assert.equal(injectCodeModeToolsPrompt(withCustom, tools, "/custom-tools.md"), withCustom);
});

test("ALL_TOOLS exposes only deferred configured custom tools", () => {
	const promoted = customTool("promoted_tool", false);
	const deferred = customTool("deferred_tool", true);
	const state = {
		ALL_TOOLS: [bundled, promoted, deferred].map(({ name, description }) => ({
			name,
			description,
		})),
	};
	const source = scopeAllToolsToDeferredCustom("", [bundled, promoted, deferred]);
	Function("globalThis", source)(state);

	assert.deepEqual(state.ALL_TOOLS, [
		{ name: "deferred_tool", description: "deferred_tool help" },
	]);
});

test("late custom-tool promotion stays deferred until the prompt snapshot refreshes", () => {
	const initial = customTool("initial_tool", false);
	const late = customTool("late_tool", false);
	const liveBundled = {
		...bundled,
		name: "live_programmatic_tool",
		usage: "await tools.live_programmatic_tool()",
	};
	let discovered: CodeModeToolDefinition[] = [bundled, initial];
	const runtime = new SharedCodeModeRuntime();
	runtime.addProvider({ getTools: () => discovered });

	const initialSnapshot = runtime.refreshPromptTools();
	const basePrompt = "Tools available in exec:\n- user_owned_tool\n\nBase";
	const initialSection = buildCodeModeToolsPrompt(initialSnapshot, "/custom-tools.md", basePrompt);
	const initialPrompt = injectCodeModeToolsPrompt(basePrompt, initialSnapshot, "/custom-tools.md");
	discovered = [bundled, liveBundled, late];

	assert.deepEqual(runtime.collectPromptTools().map((tool) => tool.name), ["exec_command", "live_programmatic_tool", "initial_tool"]);
	assert.equal(runtime.collectTools().find((tool) => tool.name === "late_tool")?.deferLoading, true);
	assert.equal(runtime.collectTools().some((tool) => tool.name === "initial_tool"), false);
	assert.match(buildCodeModeToolsPrompt(runtime.collectPromptTools()), /await tools\.live_programmatic_tool\(\)/);
	assert.match(buildCodeModeToolsPrompt(runtime.collectPromptTools()), /await tools\.initial_tool\(input\)/);
	assert.doesNotMatch(buildCodeModeToolsPrompt(runtime.collectPromptTools()), /late_tool/);
	assert.doesNotMatch(initialPrompt, /late_tool/);

	const refreshedSnapshot = runtime.refreshPromptTools();
	const refreshedPrompt = replaceCodeModeToolsPrompt(
		initialPrompt,
		initialSection,
		refreshedSnapshot,
		"/custom-tools.md",
	).systemPrompt;
	assert.equal(runtime.collectTools().find((tool) => tool.name === "late_tool")?.deferLoading, false);
	assert.equal(refreshedPrompt.match(/Tools available in exec:/g)?.length, 1);
	assert.match(refreshedPrompt, /- user_owned_tool/);
	assert.match(refreshedPrompt, /Configured custom tools:\n- await tools\.late_tool\(input\)/);
	assert.doesNotMatch(refreshedPrompt, /initial_tool/);
});
