import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDynamicTools } from "../src/tools.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function fakePi(events: object = {}) {
	const tools: string[] = [];
	const handlers = new Map<string, (event: any) => any>();
	return {
		api: {
			events,
			registerTool(tool: { name: string }) {
				tools.push(tool.name);
			},
			on(event: string, handler: (value: any) => any) {
				handlers.set(event, handler);
			},
		},
		tools,
		handlers,
	};
}

function emptyToolsDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-dynamic-tools-"));
	dirs.push(dir);
	return dir;
}

describe("dynamic tool registration", () => {
	test("registers exec and wait with an empty catalog", async () => {
		const fake = fakePi();
		await registerDynamicTools(fake.api as never, emptyToolsDir());
		expect(fake.tools).toEqual(["exec", "wait"]);
	});

	test("does not register twice through direct and aggregate packages", async () => {
		const events = {};
		const direct = fakePi(events);
		const aggregate = fakePi(events);
		const dir = emptyToolsDir();
		const runtime = await registerDynamicTools(direct.api as never, dir);
		await registerDynamicTools(aggregate.api as never, dir);
		expect(direct.tools).toEqual(["exec", "wait"]);
		expect(aggregate.tools).toEqual([]);

		await runtime.shutdown();
		await registerDynamicTools(aggregate.api as never, dir);
		expect(aggregate.tools).toEqual(["exec", "wait"]);
	});

	test("rediscovers promoted tools before each agent turn", async () => {
		const fake = fakePi();
		const dir = emptyToolsDir();
		await registerDynamicTools(fake.api as never, dir);
		const handler = fake.handlers.get("before_agent_start");
		expect(handler).toBeDefined();
		const first = handler!({ systemPrompt: "Base" });
		expect(first.systemPrompt).not.toContain("late_tool");
		writeFileSync(
			join(dir, "late_tool.toml"),
			'defer_loading = false\nusage = "await tools.late_tool(query)"\ncommand = "late-tool"\n',
		);
		const second = handler!({ systemPrompt: "Base" });
		expect(second.systemPrompt).toContain(
			"late_tool: await tools.late_tool(query)",
		);
	});
});
