import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { buildCodeModeToolsPrompt } from "../src/tools/code-mode/custom-tool-prompt.ts";
import { NotebookCell } from "../src/tools/notebook-mode/cell.ts";
import { createNotebookControlProxy } from "../src/tools/code-mode/notebook-tool.ts";
import { SharedCodeModeRuntime } from "../src/tools/code-mode/shared-runtime.ts";
import type { NotebookControlRequest, ToolExecutionContext } from "../src/tools/code-mode/types.ts";

test("Notebook exec proxy shares control normalization without changing the prompt", async () => {
	const calls: Array<{
		request: NotebookControlRequest;
		context: ToolExecutionContext;
		signal: AbortSignal | undefined;
	}> = [];
	const runtime = {
		async controlNotebook(request, context, signal) {
			calls.push({ request, context, signal });
			return { message: `Ran ${request.action}`, details: { action: request.action } };
		},
	} as Pick<SharedCodeModeRuntime, "controlNotebook"> as SharedCodeModeRuntime;
	const proxy = createNotebookControlProxy(runtime);
	const context: ToolExecutionContext = { cwd: "/project", toolCallId: "nested-notebook" };
	const controller = new AbortController();
	const modes = new SharedCodeModeRuntime();
	modes.addProvider({
		getTools: () => [],
		executionKind: (mode) => mode as "code" | "notebook",
	});

	assert.equal(proxy.deferLoading, true);
	assert.equal(buildCodeModeToolsPrompt([proxy]), "");
	assert.deepEqual(modes.collectTools("code"), []);
	assert.equal(modes.collectTools("notebook").at(-1)?.name, "notebook");
	for (const request of [
		{ action: "status" },
		{ action: "list", query: "saved*" },
		{ action: "diagnostics" },
	] as const) {
		assert.deepEqual(
			await proxy.invoke(request, context, controller.signal),
			{ message: `Ran ${request.action}`, details: { action: request.action } },
		);
	}
	assert.deepEqual(calls.map(({ request }) => request), [
		{ action: "status" },
		{ action: "list", query: "saved*" },
		{ action: "diagnostics" },
	]);
	for (const request of [
		{ action: "status", query: "bindings*" },
		{ action: "checkpoint" },
		{ action: "save", name: "profile" },
		{ action: "load", name: "profile" },
		{ action: "pin", names: ["alpha", "alpha"] },
		{ action: "unpin", names: ["alpha"] },
		{ action: "release", names: ["alpha"] },
		{ action: "prune", query: "alpha*" },
		{ action: "restart" },
		{ action: "reset" },
	] as const) {
		const normalized = request.action === "pin"
			? { action: "pin" as const, names: ["alpha"] }
			: request;
		assert.deepEqual(
			await proxy.invoke(request, context, controller.signal),
			{
				message: `Notebook ${request.action} was not run because it needs the active exec cell to finish. After exec returns, call notebook with ${JSON.stringify(normalized)}.`,
				details: { notRun: true, action: request.action, retry: normalized },
			},
		);
	}
	assert.equal(calls.length, 3);
	assert.equal(calls.every((call) => call.context === context && call.signal === controller.signal), true);
	await assert.rejects(
		proxy.invoke({ action: "save", query: "wrong" }, context, controller.signal),
		/notebook save accepts name only/,
	);
	assert.equal(calls.length, 3);

	const cell = new NotebookCell({
		id: "blocked-cell",
		source: "",
		context: { cwd: process.cwd() },
		maxOutputTokens: 1,
	});
	const observationController = new AbortController();
	for (const blocker of ["first", "second"]) {
		cell.setBlocked(blocker, true);
		const observation = cell.observe(0, observationController.signal);
		await Promise.resolve();
		cell.setBlocked(blocker, false);
		await observation;
	}
	assert.equal(
		getEventListeners(observationController.signal, "abort").length,
		0,
	);
});
