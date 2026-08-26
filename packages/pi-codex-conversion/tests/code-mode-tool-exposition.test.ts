import assert from "node:assert/strict";
import test from "node:test";
import { scopeAllToolsToDeferredCustom } from "../src/tools/code-mode/host-client.ts";
import type {
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

test("ALL_TOOLS exposes deferred configured and opted-in programmatic tools", () => {
	const promoted = customTool("promoted_tool", false);
	const deferred = customTool("deferred_tool", true);
	const deferredProgrammatic = {
		...bundled,
		name: "deferred_programmatic_tool",
		deferLoading: true,
		discoverWhenDeferred: true,
	};
	const state = {
		ALL_TOOLS: [bundled, promoted, deferred, deferredProgrammatic].map(({ name, description }) => ({
			name,
			description,
		})),
	};
	const source = scopeAllToolsToDeferredCustom("", [bundled, promoted, deferred, deferredProgrammatic]);
	Function("globalThis", source)(state);

	assert.deepEqual(state.ALL_TOOLS, [
		{ name: "deferred_tool", description: "deferred_tool help" },
		{ name: "deferred_programmatic_tool", description: "Run command" },
	]);
});
