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
	const emitted: string[] = [];
	const commandResult = {
		output: "quoted \"value\" and literal \\n\\nactual newline\n",
		session_id: 41,
		original_token_count: 19,
		continuation: "resume session 41",
	};
	const stdinResult = {
		output: "stdout says exit_code: 0\n",
		exit_code: 7,
		wall_time_seconds: 0.25,
	};
	const kernel: Record<string, unknown> = {
		fetch: async (_url: string, request: { body: string }) => {
			const payload = JSON.parse(request.body);
			if (payload.kind === "emit") {
				emitted.push(...payload.items.map((item: { text?: string }) => item.text ?? ""));
				return { ok: true, text: async () => JSON.stringify({ ok: true }) };
			}
			if (payload.kind === "tool") {
				calls.push(payload.toolName);
				const result = payload.toolName.name === "exec_command"
					? commandResult
					: payload.toolName.name === "write_stdin"
						? stdinResult
						: "delivered";
				return { ok: true, text: async () => JSON.stringify({ ok: true, result }) };
			}
			return { ok: true, text: async () => JSON.stringify({ ok: true }) };
		},
	};
	const bootstrap = new Function("globalThis", "Deno", "setInterval", "clearInterval",
		`return (async () => ${notebookBootstrapSource("http://localhost", "token", "exit", "/project")})()`);
	await bootstrap(kernel, { chdir() {}, ppid: 1, memoryUsage: () => ({ rss: 0 }) }, () => 0, () => {});
	const runtime = kernel["__piNotebook"] as {
		begin(
			id: string,
			tools: unknown[],
			names: Record<string, { name: string }>,
			outputHints?: Record<string, string>,
		): Promise<void>;
		end(id: string): void;
	};
	const text = kernel["text"] as (value: unknown) => void;
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
	const retainedCommandResult = await tools["exec_command"]!({ cmd: "printf output" });
	assert.deepEqual(retainedCommandResult, commandResult);
	text(retainedCommandResult);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(emitted.at(-1), JSON.stringify(commandResult));
	assert.deepEqual(calls, [{ name: "deferred-programmatic-tool" }, { name: "exec_command" }]);
	runtime.end("first");
	await runtime.begin("second", [], {
		exec_command: { name: "exec_command" },
		write_stdin: { name: "write_stdin" },
	}, {
		exec_command: "plain-command",
		write_stdin: "plain-command",
	});
	assert.deepEqual(Object.keys(tools), ["exec_command", "write_stdin"]);
	text(retainedCommandResult);
	const returnedStdinResult = await tools["write_stdin"]!({ session_id: 41 });
	assert.deepEqual(returnedStdinResult, stdinResult);
	text(returnedStdinResult);
	text({ ...commandResult });
	text(JSON.stringify(commandResult));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(emitted.slice(-4), [
		'{"session_id":41,"original_token_count":19,"continuation":"resume session 41"}\nOutput:\n' + commandResult.output,
		'{"exit_code":7,"wall_time_seconds":0.25}\nOutput:\n' + stdinResult.output,
		JSON.stringify(commandResult),
		JSON.stringify(commandResult),
	]);
	runtime.end("second");
	await runtime.begin("third", [], { exec_command: { name: "exec_command" } });
	text(retainedCommandResult);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(emitted.at(-1), JSON.stringify(commandResult));
	runtime.end("third");
});
