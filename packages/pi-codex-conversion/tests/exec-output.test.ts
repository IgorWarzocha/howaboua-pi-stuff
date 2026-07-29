import assert from "node:assert/strict";
import test from "node:test";
import { createExecCommandTracker } from "../src/tools/exec/command-state.ts";
import { createExecCommandTool } from "../src/tools/exec/command-tool.ts";
import { consumeOutput, peekOutputSince, truncateOutput, truncateToTail } from "../src/tools/exec/output.ts";
import type { ExecSessionManager } from "../src/tools/exec/session-manager.ts";

test("bounded raw output resumes deltas after rollover", () => {
	const session = { buffer: "abcdefghij", bufferStartOffset: 0, emittedOffset: 0 };

	assert.equal(consumeOutput(session).output, "abcdefghij");
	const baselineOffset = session.bufferStartOffset + session.buffer.length;
	const firstRollover = truncateToTail(`${session.buffer}klm`, 10);
	session.buffer = firstRollover.output;
	session.bufferStartOffset += firstRollover.removed;
	assert.equal(peekOutputSince(session, baselineOffset).output, "klm");
	assert.equal(consumeOutput(session).output, "klm");

	const secondRollover = truncateToTail(`${session.buffer}nopqrstuvwxyzABCDEFG`, 10);
	session.buffer = secondRollover.output;
	session.bufferStartOffset += secondRollover.removed;
	assert.deepEqual(consumeOutput(session), { output: "xyzABCDEFG", original_token_count: 5 });
	assert.equal(truncateToTail(`${"x".repeat(4)}😀z`, 2).output, "z");
	assert.equal(truncateOutput(`x😀${"y".repeat(255)}`, 1).output, "y".repeat(255));
});

test("settled collapsed exec output is recomputed only after width changes or invalidation", () => {
	const tool = createExecCommandTool(createExecCommandTracker(), {} as ExecSessionManager, { showOutputWhenCollapsed: true });
	const renderResult = tool.renderResult!;
	let outputReads = 0;
	const details = {
		chunk_id: "chunk",
		wall_time_seconds: 1,
		get output() {
			outputReads += 1;
			return "x".repeat(1_000);
		},
	};
	const component = renderResult(
		{ content: [], details },
		{ expanded: false, isPartial: false },
		{ fg: (_role: string, text: string) => text } as never,
		{ args: { cmd: "printf output" } } as never,
	);
	outputReads = 0;

	component.render(80);
	component.render(80);
	assert.equal(outputReads, 1);

	component.render(100);
	assert.equal(outputReads, 2);

	component.invalidate();
	component.render(100);
	assert.equal(outputReads, 3);
});
