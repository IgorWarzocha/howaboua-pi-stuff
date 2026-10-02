import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { NOTEBOOK_PARAMETERS, normalizeNotebookRequest, registerNotebookTool } from "../src/tools/code-mode/notebook-tool.ts";
import type { NotebookControlRequest } from "../src/tools/code-mode/types.ts";
import { notebookStatusSource } from "../src/tools/notebook-mode/lifecycle-runtime.ts";

test("notebook request validation preserves action routing and rejects mismatched fields", async () => {
	for (const hook of ["startup", "tool_result", false] as const) {
		assert.deepEqual(
			normalizeNotebookRequest({ action: "pin", names: ["setup", "setup"], hook }),
			{ action: "pin", names: ["setup"], hook },
		);
	}
	assert.throws(() => normalizeNotebookRequest({ action: "checkpoint", hook: "startup" }), /hook requires pin/);
	assert.throws(() => normalizeNotebookRequest({ action: "save", names: ["scratch"] }), /accepts name only/);
	assert.deepEqual(normalizeNotebookRequest({
		action: "status",
		query: null,
		name: null,
		names: null,
		hook: null,
	} as never), { action: "status" });

	const requests: NotebookControlRequest[] = [];
	let tool: ToolDefinition<typeof NOTEBOOK_PARAMETERS> | undefined;
	const controller = new AbortController();
	const context = { cwd: "/project" };
	registerNotebookTool({
		registerTool(value: ToolDefinition<typeof NOTEBOOK_PARAMETERS>) { tool = value; },
	} as never, {
		async controlNotebook(request: NotebookControlRequest, executionContext: { cwd: string; extensionContext: unknown }, signal: AbortSignal) {
			assert.equal(executionContext.cwd, context.cwd);
			assert.equal(executionContext.extensionContext, context);
			assert.equal(signal, controller.signal);
			requests.push(request);
			return { message: request.action, details: { action: request.action } };
		},
	} as never);
	assert.ok(tool);
	const native = tool;
	const call = (input: string) => native.execute("call", { input }, controller.signal, undefined, context as never);
	const help = await call("help");
	assert.equal(requests.length, 0);
	const example = help.content[0];
	assert.ok(example?.type === "text");
	const exampleInput = JSON.parse(example.text.split("\n")[1]!.slice("Example: ".length)).input;
	await call(exampleInput);
	assert.deepEqual(requests.pop(), { action: "status", query: "*" });

	for (const invalid of [
		null,
		{ action: "status", query: 1 }, { action: "status", extra: true },
		{ action: "save" }, { action: "save", name: "saved", names: ["scratch"] },
	]) await assert.rejects(() => call(JSON.stringify(invalid)), /notebook/);
	await assert.rejects(() => call("{"), /JSON action object/);
	assert.deepEqual(requests, []);
});

test("notebook status does not invoke binding metadata getters", async () => {
	let getterCalls = 0;
	class Resource {
		[Symbol.dispose]() {}
	}
	const probe = new Resource();
	for (const key of ["constructor", Symbol.asyncDispose, Symbol.toStringTag]) {
		Object.defineProperty(probe, key, { get() { getterCalls += 1; throw new Error("getter invoked"); } });
	}
	let output = "";
	const run = new Function("Deno", "console", "probe", `return (async () => ${notebookStatusSource(["probe"], "MARKER")})()`);
	await run(
		{ memoryUsage: () => ({ heapUsed: 1, heapTotal: 2, rss: 3, external: 4 }) },
		{ log: (value: string) => { output += value; } },
		probe,
	);

	assert.equal(getterCalls, 0);
	assert.match(output, /^MARKER\{"memory":/);
	assert.match(output, /"disposable":"sync"/);
});
