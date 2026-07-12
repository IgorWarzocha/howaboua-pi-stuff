import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseDynamicTool } from "../src/tools/code-mode/config.ts";
import { buildPromotedToolsPrompt } from "../src/tools/code-mode/prompt.ts";
import { registerDynamicTools } from "../src/tools/code-mode/tools.ts";

test("Code Mode keeps TOML tools deferred unless promoted", () => {
	const deferred = parseDynamicTool(
		"/tmp/rare_tool.toml",
		'usage = "await tools.rare_tool(input)"\ncommand = "rare-tool"\n',
	);
	const promoted = parseDynamicTool(
		"/tmp/common_tool.toml",
		'usage = "await tools.common_tool(input)"\ncommand = "common-tool"\ndefer_loading = false\n',
	);
	assert.equal(deferred.deferLoading, true);
	assert.equal(promoted.deferLoading, false);
	assert.equal(
		buildPromotedToolsPrompt([deferred, promoted]),
		"Dynamic tools available in exec:\n- common_tool: await tools.common_tool(input)",
	);
});

test("Code Mode invokes a deferred TOML tool without exposing its schema", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-codex-code-mode-"));
	await writeFile(
		join(dir, "echo.toml"),
		'usage = "await tools.echo(input)"\ncommand = "printf"\nargs = ["dynamic:%s"]\n',
	);
	const tools = new Map<string, any>();
	const pi = {
		events: {},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
		on() {},
	};
	const runtime = await registerDynamicTools(pi as never, dir);
	try {
		const exec = tools.get("exec");
		assert.ok(exec);
		const result = await exec.execute(
			"exec-dynamic",
			{ code: 'text(await tools.echo("ok"));' },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		assert.match(
			result.content
				.map((item: { text?: string }) => item.text ?? "")
				.join("\n"),
			/dynamic:ok/,
		);
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
	const first = await registerDynamicTools(pi as never, "/missing");
	await first.shutdown();
	const second = await registerDynamicTools(pi as never, "/missing");
	await second.shutdown();
	assert.equal(toolRegistrations, 2);
	assert.equal(eventRegistrations, 1);
});
