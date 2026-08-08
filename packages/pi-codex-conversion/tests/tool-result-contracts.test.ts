import test from "node:test";
import assert from "node:assert/strict";
import {
	registerApplyPatchResultEvent,
} from "../src/tools/apply-patch/tool.ts";

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
