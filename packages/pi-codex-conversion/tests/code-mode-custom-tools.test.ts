import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	discoverCustomTools,
	getCustomToolsDir,
	parseCustomTool,
} from "../src/tools/code-mode/custom-tools.ts";
import { buildPromotedToolsPrompt } from "../src/tools/code-mode/custom-tool-prompt.ts";
import { registerCustomTools } from "../src/tools/code-mode/tools.ts";

test("Code Mode keeps TOML tools deferred unless promoted", () => {
	assert.equal(
		getCustomToolsDir("/agent"),
		join("/agent", "codex-conversion-custom-tools"),
	);
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

test("Code Mode bundles working custom tool templates", () => {
	const examplesDir = join(import.meta.dirname, "..", "examples", "custom-tools");
	const examples = discoverCustomTools(examplesDir);
	assert.deepEqual(
		examples.map((tool) => tool.name),
		["port_info", "semantic_grep", "spawn_agent", "vent", "workflows_create"],
	);
	for (const tool of examples) {
		assert.equal(tool.command, process.execPath);
		assert.ok(tool.args[0] && existsSync(tool.args[0]));
	}
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

		const truncated = await exec.execute(
			"exec-truncated",
			{
				code: 'await tools.echo("x".repeat(40000));',
			},
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		assert.match(
			truncated.details.traces[0].result.content[0].text,
			/Trace output truncated/,
		);

		const bounded = await exec.execute(
			"exec-bounded",
			{
				code: "await Promise.all(Array.from({ length: 51 }, (_, index) => tools.echo(String(index))));",
			},
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		assert.equal(bounded.details.traces.length, 50);
		assert.equal(bounded.details.droppedTraceCount, 1);
		const retainedText = bounded.details.traces
			.flatMap(
				(trace: { result?: { content?: Array<{ text?: string }> } }) =>
					trace.result?.content ?? [],
			)
			.map((item: { text?: string }) => item.text ?? "")
			.join("\n");
		assert.ok(retainedText.length < 100_000);
	} finally {
		await runtime.shutdown();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Code Mode reuses its registered tool and event surface", async () => {
	let toolRegistrations = 0;
	let eventRegistrations = 0;
	const pi = {
		events: {},
		registerTool() {
			toolRegistrations += 1;
		},
		on() {
			eventRegistrations += 1;
		},
	};
	const first = await registerCustomTools(pi as never, "/missing");
	await first.shutdown();
	const second = await registerCustomTools(pi as never, "/missing");
	await second.shutdown();
	assert.equal(toolRegistrations, 2);
	assert.equal(eventRegistrations, 2);
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
