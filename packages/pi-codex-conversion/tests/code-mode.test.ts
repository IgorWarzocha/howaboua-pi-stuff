import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { registerCodexCodeMode } from "../src/adapter/code-mode.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { createExecCommandTracker } from "../src/tools/exec/command-state.ts";
import { createExecSessionManager } from "../src/tools/exec/session-manager.ts";

function createHarness() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
	const pi = {
		events: {},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
		on(event: string, handler: (...args: any[]) => unknown) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	return { pi, tools, handlers };
}

test("GPT-5.6 Code Mode invokes the conversion shell through V8", async () => {
	const harness = createHarness();
	const sessions = createExecSessionManager({ env: process.env });
	const runtime = {
		state: {
			enabled: true,
			cwd: process.cwd(),
			promptSkills: [],
			config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, beta: { codeMode: true } },
			codexTurnState: createCodexTurnState(),
		},
		tracker: createExecCommandTracker(),
		sessions,
	} as never;
	const codeMode = await registerCodexCodeMode(harness.pi as never, runtime);
	try {
		const promptHandler = harness.handlers.get("before_agent_start")?.[0];
		const promptResult = promptHandler?.(
			{ systemPrompt: "Base" },
			{
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
				},
			},
		) as { systemPrompt?: string } | undefined;
		assert.match(
			promptResult?.systemPrompt ?? "",
			/src\/tools\/code-mode\/DYNAMIC-TOOLS\.md/,
		);
		const exec = harness.tools.get("exec");
		assert.ok(exec);
		const result = await exec.execute(
			"exec-1",
			{
				code: 'text(await tools.exec_command({ cmd: "printf code-mode-ok" }));',
			},
			undefined,
			undefined,
			{
				cwd: process.cwd(),
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			} as never,
		);
		assert.match(
			result.content
				.map((item: { text?: string }) => item.text ?? "")
				.join("\n"),
			/code-mode-ok/,
		);

		const resumed = await exec.execute(
			"exec-2",
			{
				code: `const started = await tools.exec_command({ cmd: "sleep 0.1; printf resumed-ok", yield_time_ms: 10 });
const result = started.session_id ? await tools.write_stdin({ session_id: started.session_id, yield_time_ms: 1000 }) : started;
text(result);`,
			},
			undefined,
			undefined,
			{
				cwd: process.cwd(),
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			} as never,
		);
		assert.match(
			resumed.content
				.map((item: { text?: string }) => item.text ?? "")
				.join("\n"),
			/resumed-ok/,
		);
	} finally {
		await codeMode.shutdown();
		sessions.shutdown();
	}
});
