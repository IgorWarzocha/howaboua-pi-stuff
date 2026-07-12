import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	const patchDir = await mkdtemp(join(tmpdir(), "pi-code-mode-patch-"));
	try {
		const promptHandler = harness.handlers.get("before_agent_start")?.[0];
		const promptResult = promptHandler?.(
			{ systemPrompt: "Base" },
			{
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text", "image"],
				},
			},
		) as { systemPrompt?: string } | undefined;
		assert.match(
			promptResult?.systemPrompt ?? "",
			/src\/tools\/code-mode\/DYNAMIC-TOOLS\.md/,
		);
		assert.match(
			promptResult?.systemPrompt ?? "",
			/apply_patch: await tools\.apply_patch\(patch\)/,
		);
		assert.match(promptResult?.systemPrompt ?? "", /view_image: const result = await tools\.view_image/);
		assert.match(promptResult?.systemPrompt ?? "", /web__run: await tools\.web__run/);
		assert.match(promptResult?.systemPrompt ?? "", /image_gen__imagegen: await tools\.image_gen__imagegen/);
		const textOnlyPrompt = promptHandler?.(
			{ systemPrompt: "Base" },
			{
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			},
		) as { systemPrompt?: string } | undefined;
		assert.doesNotMatch(textOnlyPrompt?.systemPrompt ?? "", /view_image:/);
		assert.doesNotMatch(textOnlyPrompt?.systemPrompt ?? "", /image_gen__imagegen:/);
		(runtime as any).state.config.tools.viewImageFallback = true;
		const fallbackPrompt = promptHandler?.(
			{ systemPrompt: "Base" },
			{
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			},
		) as { systemPrompt?: string } | undefined;
		assert.match(fallbackPrompt?.systemPrompt ?? "", /view_image: const description = await tools\.view_image/);
		(runtime as any).state.config.tools.viewImageFallback = false;
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

		await writeFile(join(patchDir, "seed.txt"), "BEFORE\n");
		const patched = await exec.execute(
			"exec-patch",
			{
				code: `await tools.apply_patch("*** Begin Patch\\n*** Update File: seed.txt\\n@@\\n-BEFORE\\n+AFTER\\n*** End Patch");`,
			},
			undefined,
			undefined,
			{
				cwd: patchDir,
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			} as never,
		);
		assert.equal(await readFile(join(patchDir, "seed.txt"), "utf8"), "AFTER\n");
		assert.equal(patched.details.traces[0].name, "apply_patch");
		assert.equal(typeof patched.details.traces[0].input, "string");
		assert.match(
			exec
				.renderResult(
					patched,
					{ expanded: false, isPartial: false },
					{
						fg: (_role: string, text: string) => text,
						bold: (text: string) => text,
					},
					{ toolCallId: "exec-patch", cwd: patchDir },
				)
				.render(120)
				.join("\n"),
			/Edited seed\.txt/,
		);
		const imagePath = join(patchDir, "pixel.png");
		await writeFile(
			imagePath,
			Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"),
		);
		const viewed = await exec.execute(
			"exec-view-image",
			{ code: `image(await tools.view_image({ path: ${JSON.stringify(imagePath)}, detail: "original" }));` },
			undefined,
			undefined,
			{
				cwd: patchDir,
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text", "image"],
				},
			} as never,
		);
		assert.equal(viewed.details.traces[0].name, "view_image");
		assert.equal(viewed.details.traces[0].status, "done");
		assert.ok(viewed.content.some((item: { type: string }) => item.type === "image"));
		const partialPatch = `*** Begin Patch
*** Add File: created.txt
+created
*** Update File: missing.txt
@@
-missing
+updated
*** End Patch`;
		const partial = await exec.execute(
			"exec-patch-partial",
			{ code: `await tools.apply_patch(${JSON.stringify(partialPatch)});` },
			undefined,
			undefined,
			{
				cwd: patchDir,
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			} as never,
		);
		assert.match(partial.details.scriptError, /partially failed/i);
		assert.equal(partial.details.traces[0].status, "error");
		assert.equal(
			partial.details.traces[0].result.details.status,
			"partial_failure",
		);
		assert.equal(
			await readFile(join(patchDir, "created.txt"), "utf8"),
			"created\n",
		);
		const malformedPatch = await exec.execute(
			"exec-patch-malformed",
			{ code: "await tools.apply_patch({ patch: 'nope' });" },
			undefined,
			undefined,
			{
				cwd: patchDir,
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			} as never,
		);
		assert.match(malformedPatch.details.scriptError, /expects a patch string/);
		assert.deepEqual(
			malformedPatch.details.traces.map(
				(trace: { name: string; status: string }) => [trace.name, trace.status],
			),
			[["apply_patch", "error"]],
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
		await rm(patchDir, { recursive: true, force: true });
	}
});
