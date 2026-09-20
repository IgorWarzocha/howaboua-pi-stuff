import test from "node:test";
import assert from "node:assert/strict";
import { registerApplyPatchResultEvent } from "../src/index.ts";
import { toCodeModeToolResult } from "../src/tools/code-mode/tool-result.ts";

test("apply_patch partial mutations remain error results", () => {
	let handler: ((event: { toolName: string; details: unknown }) => unknown) | undefined;
	registerApplyPatchResultEvent({
		on(event: string, registered: (...args: never[]) => unknown) {
			if (event === "tool_result") handler = registered as typeof handler;
		},
	} as never);
	const result = {
		changedFiles: [],
		createdFiles: [],
		deletedFiles: [],
		movedFiles: [],
		fuzz: 0,
	};

	assert.deepEqual(handler?.({
		toolName: "apply_patch",
		details: { status: "partial_failure", result },
	}), { isError: true });
	assert.equal(handler?.({ toolName: "apply_patch", details: { status: "success", result } }), undefined);
});

test("Notebook results retain output, recovery and memory pressure without success boilerplate", () => {
	const completed = toCodeModeToolResult({
		kind: "result", cellId: "complete",
		contentItems: [{ type: "input_text", text: "Script completed" }],
	});
	assert.deepEqual(completed.content, [{ type: "text", text: "Script completed" }]);
	assert.equal(completed.details.statusPrefix, false);
	const empty = toCodeModeToolResult({ kind: "result", cellId: "empty", contentItems: [] });
	assert.deepEqual(empty.content, [{ type: "text", text: "OK" }]);
	assert.equal(empty.details.statusPrefix, true);
	const result = toCodeModeToolResult({
		kind: "yielded",
		cellId: "notebook-1",
		contentItems: [],
		notebookMemory: {
			heapUsedBytes: 950,
			heapTotalBytes: 960,
			rssBytes: 1_200,
			externalBytes: 10,
			heapLimitBytes: 1_000,
		},
	});
	const text = result.content.map((item) => item.type === "text" ? item.text : "").join("\n");
	assert.match(text, /Notebook memory:/);
	assert.match(text, /CRITICAL:/);

	const failed = toCodeModeToolResult({
		kind: "result",
		cellId: "notebook-2",
		contentItems: [],
		errorText: "SyntaxError: Identifier 'patch' has already been declared",
	});
	assert.match(
		failed.content.map((item) => item.type === "text" ? item.text : "").join("\n"),
		/retry one-off code inside \{ \.\.\. \}/,
	);
});
