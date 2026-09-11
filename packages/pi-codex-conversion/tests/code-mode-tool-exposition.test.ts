import assert from "node:assert/strict";
import test from "node:test";
import { formatCodeModeToolHelp } from "../src/tools/code-mode/custom-tool-prompt.ts";
import { scopeAllToolsToDeferredCustom } from "../src/tools/code-mode/host-client.ts";
import { codeModeGlobalName } from "../src/tools/code-mode/tool-identity.ts";
import { notebookBootstrapSource } from "../src/tools/notebook-mode/kernel-runtime.ts";
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

test("Notebook tool names follow the live registry while ALL_TOOLS contains deferred help", async () => {
	const promoted = customTool("promoted_tool", false);
	const deferred = customTool("deferred_tool", true);
	const deferredProgrammatic = {
		...bundled,
		name: "deferred-programmatic-tool",
		usage: 'await tools["deferred-programmatic-tool"]({ cmd })',
		deferLoading: true,
		discoverWhenDeferred: true,
	};
	const state = {
		ALL_TOOLS: [bundled, promoted, deferred, deferredProgrammatic].map(({ name, description }) => ({
			name: codeModeGlobalName(name),
			description,
		})),
	};
	const source = scopeAllToolsToDeferredCustom("", [bundled, promoted, deferred, deferredProgrammatic]);
	Function("globalThis", source)(state);

	assert.deepEqual(state.ALL_TOOLS, [
		{ name: "deferred_tool", description: "deferred_tool help" },
		{ name: "deferred_programmatic_tool", description: "Run command" },
	]);
	assert.match(
		formatCodeModeToolHelp(deferredProgrammatic),
		/^Usage: await tools\.deferred_programmatic_tool\(\{ cmd \}\)/,
	);

	const calls: unknown[] = [];
	const kernel: Record<string, unknown> = {
		fetch: async (_url: string, request: { body: string }) => {
			const payload = JSON.parse(request.body);
			if (payload.kind === "tool") calls.push(payload.toolName);
			return { ok: true, text: async () => JSON.stringify({ ok: true, result: "delivered" }) };
		},
	};
	const bootstrap = new Function("globalThis", "Deno", "setInterval", "clearInterval",
		`return (async () => ${notebookBootstrapSource("http://localhost", "token", "exit", "/project")})()`);
	await bootstrap(kernel, { chdir() {}, ppid: 1, memoryUsage: () => ({ rss: 0 }) }, () => 0, () => {});
	const runtime = kernel["__piNotebook"] as {
		begin(id: string, tools: unknown[], names: Record<string, { name: string }>): Promise<void>;
		end(id: string): void;
	};
	await runtime.begin("first", state.ALL_TOOLS, {
		exec_command: { name: "exec_command" },
		deferred_programmatic_tool: { name: "deferred-programmatic-tool" },
	});
	const tools = kernel["tools"] as Record<string, (input: unknown) => Promise<unknown>>;
	assert.deepEqual(Object.keys(tools), ["exec_command", "deferred_programmatic_tool"]);
	assert.equal("exec_command" in tools, true);
	assert.equal("missing" in tools, false);
	assert.equal(Object.hasOwn(tools, "exec_command"), true);
	assert.equal(Object.hasOwn(tools, "missing"), false);
	assert.equal(await tools["deferred_programmatic_tool"]!({}), "delivered");
	assert.deepEqual(calls, [{ name: "deferred-programmatic-tool" }]);
	runtime.end("first");
	await runtime.begin("second", [], { replacement: { name: "replacement" } });
	assert.deepEqual(Object.keys(tools), ["replacement"]);
	assert.equal("exec_command" in tools, false);
	runtime.end("second");
});
