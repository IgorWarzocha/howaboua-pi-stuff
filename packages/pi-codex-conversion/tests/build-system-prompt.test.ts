import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexSystemPrompt } from "../src/prompt/build-system-prompt.ts";

test("Code Mode prompt distinguishes cell and command continuations", () => {
	const prompt = buildCodexSystemPrompt("Base prompt", { mode: "code" });

	assert.match(
		prompt,
		/Continue exec cell_id with wait; continue exec_command session_id by calling tools\.write_stdin inside exec\./,
	);
});
