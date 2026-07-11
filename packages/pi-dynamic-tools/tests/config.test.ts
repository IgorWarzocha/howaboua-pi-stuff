import { describe, expect, test } from "bun:test";
import { parseDynamicTool } from "../src/config.js";

describe("dynamic tool TOML", () => {
	test("uses the filename as the freeform tool name", () => {
		expect(
			parseDynamicTool(
				"/tmp/subagent.toml",
				`
 description = "Run a discovery agent."
 command = "pi-subagent"
 args = ["--mode", "deep"]
 input = "stdin"
 `,
			),
		).toEqual({
			name: "subagent",
			description: "Run a discovery agent.",
			output: undefined,
			deferLoading: true,
			command: "pi-subagent",
			args: ["--mode", "deep"],
			input: "stdin",
			sourcePath: "/tmp/subagent.toml",
		});
	});

	test("allows self-explanatory tools and optional output help", () => {
		expect(
			parseDynamicTool(
				"/tmp/repo_snapshot.toml",
				`command = "repo-snapshot"\noutput = "JSON with files and git_status."\ndefer_loading = false`,
			),
		).toEqual({
			name: "repo_snapshot",
			description: undefined,
			output: "JSON with files and git_status.",
			deferLoading: false,
			command: "repo-snapshot",
			args: [],
			input: "arg",
			sourcePath: "/tmp/repo_snapshot.toml",
		});
	});

	test("requires filenames that are directly callable JavaScript names", () => {
		expect(() =>
			parseDynamicTool("semantic-grep.toml", `command = "semantic-grep"`),
		).toThrow("filename must be a JavaScript-compatible tool name");
	});

	test("rejects unknown fields", () => {
		expect(() =>
			parseDynamicTool(
				"tool.toml",
				`description = "x"\ncommand = "x"\nmagic = true`,
			),
		).toThrow("unknown field: magic");
	});

	test("runs a relative JavaScript command with the current runtime", () => {
		const parsed = parseDynamicTool(
			"/tmp/spawn_agent.toml",
			`command = "./spawn-agent/spawn-agent.mjs"\ninput = "stdin"`,
		);
		expect(parsed.command).toBe(process.execPath);
		expect(parsed.args).toHaveLength(1);
		expect(parsed.args[0]).toBe("/tmp/spawn-agent/spawn-agent.mjs");
		expect(parsed.deferLoading).toBe(true);
	});
});
