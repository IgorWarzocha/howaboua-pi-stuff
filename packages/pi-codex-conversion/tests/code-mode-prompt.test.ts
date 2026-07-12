import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexSystemPrompt } from "../src/prompt/build-system-prompt.ts";

test("Code Mode guidance keeps shell and PATH tools behind exec", () => {
	const prompt = buildCodexSystemPrompt("Base", {
		mode: "code",
		tools: { viewImage: true, webRun: true, imageGeneration: true },
	});
	assert.match(prompt, /tools\.exec_command inside exec/);
	assert.match(prompt, /Promise\.all/);
	assert.match(prompt, /await dependencies; overlap only independent work/);
	assert.match(prompt, /text\(\) only for concise values/);
	assert.match(prompt, /tools\.apply_patch\(patch\)/);
	assert.doesNotMatch(prompt, /apply_patch <<'PATCH'/);
	assert.doesNotMatch(prompt, /Run independent exec_command calls in parallel/);
});
