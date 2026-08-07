import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { garbageCollectSupersededNotebookCheckpoints } from "../src/tools/notebook-mode/checkpoint.ts";

test("Notebook checkpoint GC removes only superseded epochs from the same session", () => {
	const agentDir = join(tmpdir(), `pi-notebook-gc-${process.pid}-${Date.now()}`);
	const project = resolve(agentDir, "project");
	const currentSession = "session-a\0current";
	const current = checkpointDirectory(agentDir, project, currentSession);
	const superseded = writeCheckpoint(agentDir, project, "session-a\0old");
	const otherSession = writeCheckpoint(agentDir, project, "session-b\0old");
	mkdirSync(current, { recursive: true });
	try {
		garbageCollectSupersededNotebookCheckpoints({ project, session: currentSession, agentDir });
		assert.equal(existsSync(superseded), false);
		assert.equal(existsSync(otherSession), true);
		assert.equal(existsSync(current), true);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

function writeCheckpoint(agentDir: string, project: string, session: string): string {
	const directory = checkpointDirectory(agentDir, project, session);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "checkpoint.json"), `${JSON.stringify({
		schema: 1,
		project,
		session,
		deno: "test",
		v8: "test",
		payload: "checkpoint-00000000-0000-4000-8000-000000000000.bin",
		createdAt: new Date().toISOString(),
		entries: [],
		skipped: [],
	})}\n`);
	return directory;
}

function checkpointDirectory(agentDir: string, project: string, session: string): string {
	const key = createHash("sha256").update(`${project}\0${session}`).digest("hex");
	return join(agentDir, "cache", "pi-codex-conversion", "notebook-mode", "sessions", key);
}
