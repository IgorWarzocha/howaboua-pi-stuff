import { describe, expect, test } from "bun:test";
import { parseDynamicTool } from "../src/config.js";

describe("dynamic tool TOML", () => {
	test("uses the filename as the freeform tool name", () => {
		expect(
			parseDynamicTool(
				"/tmp/subagent.toml",
				`
 description = "Run a discovery agent."
 usage = 'await tools.subagent(task)'
 command = "pi-subagent"
 args = ["--mode", "deep"]
 input = "stdin"
 `,
			),
		).toEqual({
			name: "subagent",
			usage: "await tools.subagent(task)",
			description: "Run a discovery agent.",
			output: undefined,
			deferLoading: true,
			command: "pi-subagent",
			args: ["--mode", "deep"],
			input: "stdin",
			sourcePath: "/tmp/subagent.toml",
		});
	});

	test("requires usage and allows optional output help", () => {
		expect(
			parseDynamicTool(
				"/tmp/repo_snapshot.toml",
				`usage = "await tools.repo_snapshot(path)"\ncommand = "repo-snapshot"\noutput = "JSON with files and git_status."\ndefer_loading = false`,
			),
		).toEqual({
			name: "repo_snapshot",
			usage: "await tools.repo_snapshot(path)",
			description: undefined,
			output: "JSON with files and git_status.",
			deferLoading: false,
			command: "repo-snapshot",
			args: [],
			input: "arg",
			sourcePath: "/tmp/repo_snapshot.toml",
		});
	});

	test("rejects tools without an invocation contract", () => {
		expect(() =>
			parseDynamicTool("repo_snapshot.toml", `command = "repo-snapshot"`),
		).toThrow("usage must be a non-empty string");
	});

	test("requires filenames that are directly callable JavaScript names", () => {
		expect(() =>
			parseDynamicTool(
				"semantic-grep.toml",
				`usage = "await tools.semantic_grep(query)"\ncommand = "semantic-grep"`,
			),
		).toThrow("filename must be a JavaScript-compatible tool name");
	});

	test("rejects unknown fields", () => {
		expect(() =>
			parseDynamicTool(
				"tool.toml",
				`usage = "await tools.tool(input)"\ndescription = "x"\ncommand = "x"\nmagic = true`,
			),
		).toThrow("unknown field: magic");
	});

	test("runs a relative JavaScript command with the current runtime", () => {
		const parsed = parseDynamicTool(
			"/tmp/spawn_agent.toml",
			`usage = "await tools.spawn_agent(input)"\ncommand = "./spawn-agent/spawn-agent.mjs"\ninput = "stdin"`,
		);
		expect(parsed.command).toBe(process.execPath);
		expect(parsed.args).toHaveLength(1);
		expect(parsed.args[0]).toBe("/tmp/spawn-agent/spawn-agent.mjs");
		expect(parsed.deferLoading).toBe(true);
	});
});
