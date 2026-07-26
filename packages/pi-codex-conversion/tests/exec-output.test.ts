import assert from "node:assert/strict";
import test from "node:test";
import { consumeOutput, peekOutputSince, truncateOutput, truncateToTail } from "../src/tools/exec/output.ts";

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
