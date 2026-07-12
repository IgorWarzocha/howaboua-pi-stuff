import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
	codeModeHostBinaryPath,
	ensureCodeModeHostBinary,
} from "../src/binary.js";
import { CodeModeHostClient } from "../src/host-client.js";
import type { DynamicToolDefinition } from "../src/types.js";

const clients: CodeModeHostClient[] = [];

beforeAll(async () => {
	await ensureCodeModeHostBinary();
});

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.shutdown()));
});

function client(): CodeModeHostClient {
	const echo: DynamicToolDefinition = {
		name: "echo",
		description: "Echo text.",
		output: "The same text.",
		deferLoading: true,
		command: process.execPath,
		args: ["-e", "process.stdout.write(process.argv[1])"],
		input: "arg",
		sourcePath: "echo.toml",
	};
	const value = new CodeModeHostClient({
		binary: codeModeHostBinaryPath(),
		tools: [echo],
	});

	clients.push(value);
	return value;
}

describe("Codex code-mode host", () => {
	test("executes a nested TOML-defined freeform tool", async () => {
		const response = await client().execute(
			`const value = await tools.echo("hello"); text(value);`,
			{ cwd: process.cwd() },
		);
		expect(response.kind).toBe("result");
		expect(response.contentItems).toEqual([
			{ type: "input_text", text: "hello" },
		]);
	});

	test("exposes deferred tool help through ALL_TOOLS", async () => {
		const response = await client().execute(
			`text(ALL_TOOLS.find(({ name }) => name === "echo"));`,
			{ cwd: process.cwd() },
		);
		expect(response.contentItems).toEqual([
			{
				type: "input_text",
				text: '{"name":"echo","description":"Echo text.\\nOutput: The same text."}',
			},
		]);
	});

	test("accepts tools discovered after the host starts", async () => {
		const host = client();
		await host.execute(`text(ALL_TOOLS.length);`, { cwd: process.cwd() });
		const lateTool: DynamicToolDefinition = {
			name: "late_tool",
			description: "Added during the session.",
			deferLoading: true,
			command: process.execPath,
			args: ["-e", "process.stdout.write(process.argv[1])"],
			input: "arg",
			sourcePath: "late_tool.toml",
		};
		const response = await host.execute(
			`const value = await tools.late_tool("available"); text(value);`,
			{ cwd: process.cwd() },
			undefined,
			[lateTool],
		);
		expect(response.contentItems).toEqual([
			{ type: "input_text", text: "available" },
		]);
	});

	test("shares store values between exec cells", async () => {
		const host = client();
		await host.execute(`store("answer", 42);`, { cwd: process.cwd() });
		const response = await host.execute(`text(load("answer"));`, {
			cwd: process.cwd(),
		});
		expect(response.contentItems).toEqual([{ type: "input_text", text: "42" }]);
	});

	test("yields and resumes a running cell", async () => {
		const host = client();
		const started = await host.execute(
			`text("before"); yield_control(); await new Promise(resolve => setTimeout(resolve, 25)); text("later");`,
			{ cwd: process.cwd() },
		);
		expect(started.kind).toBe("yielded");
		expect(started.contentItems).toEqual([
			{ type: "input_text", text: "before" },
		]);
		const completed = await host.wait(started.cellId, 1_000, {
			cwd: process.cwd(),
		});
		expect(completed.kind).toBe("result");
		expect(completed.contentItems).toEqual([
			{ type: "input_text", text: "later" },
		]);
	});

	test("delivers notify updates and preserves them in the result", async () => {
		const updates: string[] = [];
		const response = await client().execute(
			`notify("working"); text("done");`,
			{
				cwd: process.cwd(),
				onUpdate: (result) => updates.push(result.content[0]?.text ?? ""),
			},
		);
		expect(updates).toEqual(["working"]);
		expect(response.contentItems).toEqual([
			{ type: "input_text", text: "working" },
			{ type: "input_text", text: "done" },
		]);
	});
});
