import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createApplyPatchTool,
	registerApplyPatchResultEvent,
} from "../src/tools/apply-patch/tool.ts";
import { parseViewImageParams } from "../src/tools/view-image/tool.ts";

test("apply_patch partial mutations remain error results", () => {
	let handler: ((event: { toolName: string; details: unknown }) => unknown) | undefined;
	registerApplyPatchResultEvent({
		on(event: string, registered: (...args: never[]) => unknown) {
			if (event === "tool_result") handler = registered as typeof handler;
		},
	} as never);

	assert.deepEqual(handler?.({
		toolName: "apply_patch",
		details: { status: "partial_failure", result: {} },
	}), { isError: true });
	assert.equal(handler?.({ toolName: "apply_patch", details: { status: "success", result: {} } }), undefined);
});

test("apply_patch context failures request a focused reread", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-apply-patch-error-"));
	try {
		writeFileSync(join(cwd, "target.txt"), "current line\n");
		const execution = createApplyPatchTool().execute(
			"call-context-failure",
			{
				input: [
					"*** Begin Patch",
					"*** Update File: target.txt",
					"@@",
					"-stale line",
					"+replacement line",
					"*** End Patch",
				].join("\n"),
			},
			undefined,
			undefined,
			{ cwd } as never,
		);

		await assert.rejects(execution, (error: Error) => {
			assert.match(error.message, /target\.txt: expected context not found/);
			assert.match(error.message, /Expected near: stale line/);
			assert.match(
				error.message,
				/Recovery: MUST read target\.txt and retry only the failed edit against current contents/,
			);
			assert.doesNotMatch(error.message, /order each Update File's hunks/);
			return true;
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("view_image accepts model-style path references", () => {
	assert.deepEqual(parseViewImageParams({ path: "@assets/example.png" }), { path: "assets/example.png" });
	assert.deepEqual(parseViewImageParams({ path: "assets/example.png" }), { path: "assets/example.png" });
});
