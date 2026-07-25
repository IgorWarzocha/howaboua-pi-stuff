import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	registerCodeModeTools,
	registerCustomTools,
} from "../src/tools/code-mode/tools.ts";

test("Code Mode invokes a deferred TOML tool without exposing its schema", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-codex-code-mode-"));
	await writeFile(
		join(dir, "echo.mjs"),
		'process.stdout.write(`custom:${process.argv[2]}`);\n',
	);
	await writeFile(
		join(dir, "echo.toml"),
		'usage = "await tools.echo(input)"\ncommand = "./echo.mjs"\n',
	);
	const tools = new Map<string, any>();
	const pi = {
		events: {},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
		on() {},
	};
	const runtime = await registerCustomTools(pi as never, dir);
	try {
		const exec = tools.get("exec");
		assert.ok(exec);
		const result = await exec.execute(
			"exec-custom",
			{ code: 'text(await tools.echo("ok"));' },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		assert.match(
			result.content
				.map((item: { text?: string }) => item.text ?? "")
				.join("\n"),
			/custom:ok/,
		);
		assert.deepEqual(
			result.details.traces.map((trace: { name: string; status: string }) => [
				trace.name,
				trace.status,
			]),
			[["echo", "done"]],
		);
		const rendered = exec.renderResult(
			result,
			{ expanded: false, isPartial: false },
			{
				fg: (_role: string, text: string) => text,
				bold: (text: string) => text,
			},
			{ toolCallId: "exec-custom", cwd: process.cwd() },
		);
		assert.match(rendered.render(120).join("\n"), /custom:ok/);
	} finally {
		await runtime.shutdown();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Code Mode removes stale providers before rebinding after reload", async () => {
	const events = {};
	const createApi = () => {
		const tools = new Map<string, any>();
		return {
			pi: {
				events,
				registerTool(tool: { name: string }) {
					tools.set(tool.name, tool);
				},
				on() {},
			},
			tools,
		};
	};
	const nestedTool = (name: string) => ({
		name,
		usage: `await tools.${name}({})`,
		deferLoading: false,
		kind: "function" as const,
		inputSchema: { type: "object", properties: {} },
		async invoke() {
			return name;
		},
	});
	const firstApi = createApi();
	const first = await registerCodeModeTools(firstApi.pi as never, {
		getTools: () => [nestedTool("old_tool")],
	});
	await first.shutdown();

	const secondApi = createApi();
	const second = await registerCodeModeTools(secondApi.pi as never, {
		getTools: () => [nestedTool("new_tool")],
	});
	try {
		const result = await secondApi.tools.get("exec").execute(
			"exec-after-reload",
			{ code: "text(`${typeof tools.old_tool}:${typeof tools.new_tool}`);" },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		assert.match(
			result.content.map((item: { text?: string }) => item.text ?? "").join("\n"),
			/undefined:function/,
		);
	} finally {
		await second.shutdown();
	}
});
