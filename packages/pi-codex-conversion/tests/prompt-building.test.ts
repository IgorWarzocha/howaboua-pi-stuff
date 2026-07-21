import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexSystemPrompt } from "../src/prompt/build-system-prompt.ts";

test("existing punctuated Pi guidelines are canonicalized before deduplication and mode removal", () => {
	const basePrompt = `Base

Guidelines:
- Use tty=true for dev servers, watchers, REPLs, and prompts.
- Use apply_patch for text-file changes, including creates/deletes/moves; split oversized patches.

Pi documentation follows`;

	const normalPrompt = buildCodexSystemPrompt(basePrompt, { mode: "normal" });
	assert.equal(normalPrompt.match(/Use tty=true for dev servers, watchers, REPLs, and prompts/g)?.length, 1);
	assert.doesNotMatch(normalPrompt, /Use tty=true for dev servers, watchers, REPLs, and prompts\./);

	const pathPrompt = buildCodexSystemPrompt(basePrompt, { mode: "path", tools: {} });
	assert.doesNotMatch(pathPrompt, /Use apply_patch for text-file changes/);
	assert.match(pathPrompt, /Use apply_patch for file edits/);
});
