import assert from "node:assert/strict";
import test from "node:test";
import { createCodeModeHarness } from "../helpers/code-mode-harness.ts";

test("Code Mode invokes and renders the conversion shell through V8", async () => {
	const fixture = await createCodeModeHarness();
	const { tools, runtime } = fixture;
	try {
		const exec = tools.get("exec");
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
	} finally {
		await fixture.close();
	}
});
