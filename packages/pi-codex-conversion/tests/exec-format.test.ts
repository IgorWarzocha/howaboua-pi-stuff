import assert from "node:assert/strict";
import test from "node:test";
import { formatUnifiedExecResult } from "../src/tools/exec/format.ts";

test("running command results name the exact continuation call", () => {
	const text = formatUnifiedExecResult({
		chunk_id: "test-chunk",
		output: "working",
		wall_time_seconds: 0.25,
		session_id: 42,
	});

	assert.match(
		text,
		/Still running\. Call write_stdin\(\{ session_id: 42 \}\)/,
	);
});
