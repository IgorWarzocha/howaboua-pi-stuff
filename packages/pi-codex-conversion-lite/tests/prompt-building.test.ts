import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexSystemPrompt } from "../src/prompt/build-system-prompt.ts";

test("existing punctuated Pi guidelines are canonicalized before Code Mode replacement", () => {
	const basePrompt = `Base

Guidelines:
- Use tty=true for dev servers, watchers, REPLs, and prompts.
- Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches.

Pi documentation follows`;

	const normalPrompt = buildCodexSystemPrompt(basePrompt, { mode: "normal" });
	assert.equal(normalPrompt.match(/Reserve tty=true for input or persistent processes/g)?.length, 1);
	assert.doesNotMatch(normalPrompt, /Use tty=true for dev servers/);

	const codePrompt = buildCodexSystemPrompt(basePrompt, { mode: "code" });
	assert.doesNotMatch(codePrompt, /Use apply_patch for text-file changes/);
	assert.match(codePrompt, /Use tools\.apply_patch/);
	assert.doesNotMatch(codePrompt, /PATH tool/);
});
