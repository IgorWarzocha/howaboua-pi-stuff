import assert from "node:assert/strict";
import test from "node:test";
import { createCodeModeHarness } from "../helpers/code-mode-harness.ts";

test("Code Mode preserves nested tools across sessions, errors, and output limits", async () => {
	const fixture = await createCodeModeHarness();
	const { tools, handlers } = fixture;
	const exec = tools.get("exec");
	try {
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
		const toolResultHandler = handlers.get("tool_result")?.[0];
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
		const wait = tools.get("wait");
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

		const abortController = new AbortController();
		const abortTimer = setTimeout(() => abortController.abort(), 20);
		await assert.rejects(
			() => exec.execute(
				"exec-abort",
				{ code: "await new Promise((resolve) => setTimeout(resolve, 60_000));" },
				abortController.signal,
				undefined,
				{ cwd: process.cwd() },
			),
			(error: unknown) => error instanceof Error && error.name === "AbortError",
		);
		clearTimeout(abortTimer);

		const terminable = await exec.execute(
			"exec-terminate",
			{ code: '// @exec: {"yield_time_ms": 10}\nawait new Promise((resolve) => setTimeout(resolve, 60_000));' },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		const terminated = await wait.execute(
			"wait-terminate",
			{ cell_id: terminable.details.cellId, terminate: true },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		assert.equal(terminated.details.status, "terminated");

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
		await fixture.close();
	}
});
