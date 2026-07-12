import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { registerCodexCodeMode } from "../src/adapter/code-mode.ts";
import {
	createCodeModeRenderTracker,
	renderExecCall,
	renderWaitCall,
} from "../src/tools/code-mode/rendering.ts";
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

test("transparent Code Mode calls retain live invalidation", () => {
	const tracker = createCodeModeRenderTracker();
	tracker.start("call-1");
	let invalidations = 0;
	renderExecCall(
		{ code: "await tools.exec_command({ cmd: 'true' })" },
		{ fg: (_role, text) => text, bold: (text) => text },
		{ toolCallId: "call-1", invalidate: () => (invalidations += 1) },
		tracker,
		false,
	);
	tracker.finish("call-1");
	tracker.start("call-2");
	renderWaitCall(
		{ cell_id: "2" },
		{ fg: (_role, text) => text, bold: (text) => text },
		{ toolCallId: "call-2", invalidate: () => (invalidations += 1) },
		tracker,
		false,
	);
	tracker.finish("call-2");
	assert.equal(invalidations, 2);
});

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
		const updates: Array<{ details?: { traces?: Array<{ status: string }> } }> =
			[];
		const result = await exec.execute(
			"exec-1",
			{
				code: 'text(await tools.exec_command({ cmd: "printf code-mode-ok" }));',
			},
			undefined,
			(update: { details?: { traces?: Array<{ status: string }> } }) =>
				updates.push(update),
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
		assert.deepEqual(
			result.details.traces.map((trace: { name: string; status: string }) => [
				trace.name,
				trace.status,
			]),
			[["exec_command", "done"]],
		);
		assert.ok(
			updates.some((update) =>
				update.details?.traces?.some((trace) => trace.status === "running"),
			),
		);
		const rendered = exec.renderResult(
			result,
			{ expanded: false, isPartial: false },
			{
				fg: (_role: string, text: string) => text,
				bold: (text: string) => text,
			},
			{ toolCallId: "exec-1", cwd: process.cwd() },
		);
		const renderedText = rendered.render(120).join("\n");
		assert.match(renderedText, /Ran/);
		assert.match(renderedText, /printf code-mode-ok/);
		assert.match(renderedText, /code-mode-ok/);
		assert.doesNotMatch(renderedText, /chunk_id/);
		assert.deepEqual(
			exec
				.renderCall(
					{
						code: 'text(await tools.exec_command({ cmd: "printf code-mode-ok" }));',
					},
					{
						fg: (_role: string, text: string) => text,
						bold: (text: string) => text,
					},
					{ toolCallId: "exec-1" },
				)
				.render(120),
			[],
		);
		(runtime as any).state.config.ui.codeModeDetails = true;
		assert.match(
			exec
				.renderCall(
					{
						code: 'text(await tools.exec_command({ cmd: "printf code-mode-ok" }));',
					},
					{
						fg: (_role: string, text: string) => text,
						bold: (text: string) => text,
					},
					{ toolCallId: "exec-1" },
				)
				.render(120)
				.join("\n"),
			/Ran code/,
		);
		assert.match(
			exec
				.renderResult(
					result,
					{ expanded: false, isPartial: false },
					{
						fg: (_role: string, text: string) => text,
						bold: (text: string) => text,
					},
					{ toolCallId: "exec-1", cwd: process.cwd() },
				)
				.render(120)
				.join("\n"),
			/chunk_id/,
		);
		(runtime as any).state.config.ui.codeModeDetails = false;

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
		assert.deepEqual(
			resumed.details.traces.map((trace: { name: string; status: string }) => [
				trace.name,
				trace.status,
			]),
			[["exec_command", "done"]],
		);

		const failed = await exec.execute(
			"exec-error",
			{
				code: 'await tools.exec_command({ cmd: "printf before-error" }); throw new Error("expected-boom");',
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
		assert.match(failed.details.scriptError, /expected-boom/);
		assert.deepEqual(
			failed.details.traces.map((trace: { name: string; status: string }) => [
				trace.name,
				trace.status,
			]),
			[["exec_command", "done"]],
		);
		const toolResultHandler = harness.handlers.get("tool_result")?.[0];
		assert.deepEqual(
			toolResultHandler?.({ toolName: "exec", details: failed.details }),
			{ isError: true },
		);

		const yielded = await exec.execute(
			"exec-yield-error",
			{
				code: `// @exec: {"yield_time_ms": 10}
await new Promise((resolve) => setTimeout(resolve, 50));
await tools.exec_command({ cmd: "printf before-wait-error" });
throw new Error("expected-wait-boom");`,
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
		assert.equal(yielded.details.status, "yielded");
		const wait = harness.tools.get("wait");
		const waited = await wait.execute(
			"wait-error",
			{ cell_id: yielded.details.cellId, yield_time_ms: 1_000 },
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
		assert.match(waited.details.scriptError, /expected-wait-boom/);
		assert.deepEqual(
			waited.details.traces.map((trace: { name: string; status: string }) => [
				trace.name,
				trace.status,
			]),
			[["exec_command", "done"]],
		);
		assert.deepEqual(
			toolResultHandler?.({ toolName: "wait", details: waited.details }),
			{ isError: true },
		);

		const images = await exec.execute(
			"exec-images",
			{
				code: 'for (let index = 0; index < 5; index += 1) image("data:image/png;base64,iVBORw0KGgo=");',
			},
			undefined,
			undefined,
			{
				cwd: process.cwd(),
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["image"],
				},
			} as never,
		);
		assert.equal(
			images.content.filter((item: { type: string }) => item.type === "image")
				.length,
			4,
		);
		assert.match(
			images.content
				.filter((item: { type: string; text?: string }) => item.type === "text")
				.map((item: { text?: string }) => item.text ?? "")
				.join("\n"),
			/1 code-mode image omitted/,
		);
		await assert.rejects(
			() =>
				exec.execute(
					"exec-oversized-output",
					{
						code: '// @exec: {"max_output_tokens": 100001}\ntext("nope");',
					},
					undefined,
					undefined,
					{ cwd: process.cwd() },
				),
			/max_output_tokens must be a safe integer from 1 to 100000/,
		);
	} finally {
		await codeMode.shutdown();
		sessions.shutdown();
	}
});
