import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCodeModeToolsPrompt,
	injectCodeModeToolsPrompt,
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
		/Read \/custom-tools\.md only to work on custom-tool definitions, not to call them/,
	);

	const basePrompt = "Base\nCurrent shell: /bin/bash";
	const withoutCustom = injectCodeModeToolsPrompt(basePrompt, [bundled], "/custom-tools.md");
	assert.match(withoutCustom, /Tools available in exec:/);
	assert.doesNotMatch(withoutCustom, /custom-tool definitions|Configured custom tools|ALL_TOOLS/);
	assert.equal(
		injectCodeModeToolsPrompt(withoutCustom, [bundled], "/custom-tools.md"),
		withoutCustom,
	);

	const withCustom = injectCodeModeToolsPrompt(withoutCustom, tools, "/custom-tools.md");
	assert.equal(withCustom.match(/Tools available in exec:/g)?.length, 1);
	assert.match(withCustom, /Configured custom tools:\n- await tools\.promoted_tool/);
	assert.match(withCustom, /Deferred custom tools: find by name in ALL_TOOLS/);
	assert.match(withCustom, /only to work on custom-tool definitions/);
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

test("the session custom-tool snapshot preserves prompt and execution boundaries", () => {
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

	const initialSnapshot = runtime.resetPromptTools();
	const basePrompt = "Tools available in exec:\n- user_owned_tool\n\nBase";
	const initialPrompt = injectCodeModeToolsPrompt(basePrompt, initialSnapshot, "/custom-tools.md");
	const updatedInitial = { ...initial, command: "updated-initial" };
	discovered = [bundled, liveBundled, updatedInitial, late];

	assert.deepEqual(runtime.collectPromptTools().map((tool) => tool.name), ["exec_command", "live_programmatic_tool", "initial_tool"]);
	const sessionTools = runtime.collectTools();
	assert.equal(sessionTools.find((tool) => tool.name === "late_tool")?.deferLoading, true);
	assert.equal((sessionTools.find((tool) => tool.name === "initial_tool") as CustomToolDefinition).command, "updated-initial");
	assert.match(buildCodeModeToolsPrompt(runtime.collectPromptTools()), /await tools\.live_programmatic_tool\(\)/);
	assert.match(buildCodeModeToolsPrompt(runtime.collectPromptTools()), /await tools\.initial_tool\(input\)/);
	assert.doesNotMatch(buildCodeModeToolsPrompt(runtime.collectPromptTools()), /late_tool/);
	assert.doesNotMatch(initialPrompt, /late_tool/);

	discovered = [bundled, liveBundled, late];
	assert.equal(runtime.collectTools().find((tool) => tool.name === "initial_tool"), initial);
});
