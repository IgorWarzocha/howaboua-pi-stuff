import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	prepareCodexVoiceSystemPrompt,
} from "../src/voice/system-prompt.ts";

test("voice prompt schema checks never rewrite a customized prompt", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-voice-prompt-"));
	const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
	const customizedPrompt = `﻿<!-- codex-voice-prompt-version: 2 -->
## Identity and tone

Keep this customized personality.

## Interface and role

One assistant.

## Delegation

Delegate work.

## Session continuity

Preserve context.

## Backend results

Speak results.
`.replaceAll("\n", "\r\n");
	await writeFile(promptPath, customizedPrompt, { mode: 0o600 });
	try {
		assert.deepEqual(prepareCodexVoiceSystemPrompt(promptPath), {
			created: false,
			schemaVersion: 2,
			currentSchemaVersion: 3,
			current: false,
		});
		assert.equal(await readFile(promptPath, "utf8"), customizedPrompt);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
