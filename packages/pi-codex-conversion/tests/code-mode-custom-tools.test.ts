import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	parseCustomTool,
} from "../src/tools/code-mode/custom-tools.ts";
import { buildPromotedToolsPrompt } from "../src/tools/code-mode/custom-tool-prompt.ts";
import {
	registerCodeModeTools,
	registerCustomTools,
} from "../src/tools/code-mode/tools.ts";

test("Code Mode keeps TOML tools deferred unless promoted", () => {
	const deferred = parseCustomTool(
		"/tmp/rare_tool.toml",
		'usage = "await tools.rare_tool(input)"\ncommand = "rare-tool"\n',
	);
	const promoted = parseCustomTool(
		"/tmp/common_tool.toml",
		'usage = "await tools.common_tool(input)"\ncommand = "common-tool"\ndefer_loading = false\n',
	);
	assert.equal(deferred.deferLoading, true);
	assert.equal(promoted.deferLoading, false);
	assert.equal(
		buildPromotedToolsPrompt([deferred, promoted]),
		"Custom tools available in exec:\n- common_tool: await tools.common_tool(input)",
	);
});

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

test("Code Mode rebinds its tool and event surface after reload", async () => {
	const events = {};
	const registrations = () => {
		let tools = 0;
		let handlers = 0;
		return {
			pi: {
				events,
				registerTool() {
					tools += 1;
				},
				on() {
					handlers += 1;
				},
			},
			counts: () => ({ tools, handlers }),
		};
	};
	const firstApi = registrations();
	const first = await registerCustomTools(firstApi.pi as never, "/missing");
	await first.shutdown();
	const secondApi = registrations();
	const second = await registerCustomTools(secondApi.pi as never, "/missing");
	await second.shutdown();
	assert.deepEqual(firstApi.counts(), { tools: 2, handlers: 2 });
	assert.deepEqual(secondApi.counts(), { tools: 2, handlers: 2 });
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

test("Code Mode keeps providers registered when its host shuts down", async () => {
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const pi = {
		events: {},
		registerTool() {},
		on(event: string, handler: (...args: any[]) => unknown) {
			handlers.set(event, handler);
		},
	};
	const registration = await registerCustomTools(pi as never, "/missing");
	try {
		await registration.shutdownHost();
		const result = handlers.get("before_agent_start")?.(
			{ systemPrompt: "Base" },
			{},
		) as { systemPrompt?: string } | undefined;
		assert.match(result?.systemPrompt ?? "", /CUSTOM-TOOLS\.md/);
	} finally {
		await registration.shutdown();
	}
});
