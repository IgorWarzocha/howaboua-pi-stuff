import assert from "node:assert/strict";
import test from "node:test";
import { createCodeModeRenderTracker } from "../../src/tools/code-mode/render-tracker.ts";
import { renderExecCall, renderWaitCall } from "../../src/tools/code-mode/rendering.ts";

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
