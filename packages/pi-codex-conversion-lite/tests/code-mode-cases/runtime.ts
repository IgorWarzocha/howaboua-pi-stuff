import assert from "node:assert/strict";
import test from "node:test";
import { createCodeModeHarness } from "../helpers/code-mode-harness.ts";

test("Code Mode preserves nested tools across sessions and cancellation", async () => {
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

		const toolResultHandler = handlers.get("tool_result")?.[0];
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

	} finally {
		await fixture.close();
	}
});
