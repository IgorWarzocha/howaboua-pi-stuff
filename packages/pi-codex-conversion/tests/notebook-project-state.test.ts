import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sessionCheckpointProjectExclusions } from "../src/tools/notebook-mode/checkpoint.ts";
import { mergeProjectState } from "../src/tools/notebook-mode/project-state-merge.ts";
import {
	PROJECT_STATE_SCHEMA,
	readProjectConflictRecord,
	readProjectStateManifest,
	type ProjectStateCandidate,
	type ProjectStateManifest,
} from "../src/tools/notebook-mode/project-state-format.ts";

test("project notebook manifests reject executable binding names", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-notebook-project-format-"));
	const path = join(root, "project.json");
	try {
		writeFileSync(path, JSON.stringify({
			schema: PROJECT_STATE_SCHEMA,
			project: "/project",
			generation: "generation",
			deno: "2.9.5",
			v8: "test",
			payload: "project-00000000-0000-0000-0000-000000000000.bin",
			createdAt: "2026-01-01T00:00:00.000Z",
			sourceSession: "session",
			entries: [{
				name: "safe);globalThis.injected=true;//",
				kind: "value",
				offset: 0,
				length: 0,
				hash: hash(Buffer.alloc(0)),
			}],
			skipped: [],
		}));
		assert.equal(readProjectStateManifest(path), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("project notebook conflicts reject payload paths outside their directory", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-notebook-project-conflict-"));
	const path = join(root, "conflict.json");
	try {
		writeFileSync(path, JSON.stringify({
			schema: PROJECT_STATE_SCHEMA,
			entries: [{ name: "safe" }],
			deletions: [],
			payload: "../../outside.bin",
		}));
		assert.equal(readProjectConflictRecord(path), undefined);
		writeFileSync(path, JSON.stringify({
			schema: PROJECT_STATE_SCHEMA,
			entries: [{ name: "safe" }],
			deletions: [],
			payload: "123-00000000-0000-0000-0000-000000000000.bin",
		}));
		assert.equal(readProjectConflictRecord(path), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("project notebook merge preserves a concurrent same-name edit", () => {
	const base = Buffer.from("base");
	const current = Buffer.from("current");
	const candidate = Buffer.from("candidate");
	const manifest = projectManifest("current-generation", current);
	const merged = mergeProjectState({
		baseline: { generation: "base-generation", entries: [{ name: "shared", hash: hash(base) }] },
		current: manifest,
		candidate: projectCandidate(candidate),
		candidatePayload: candidate,
		currentPayload: current,
	});

	assert.deepEqual(merged.conflicts, ["shared"]);
	assert.equal(merged.payload.toString(), "current");
	assert.deepEqual(merged.baseline.entries, [{ name: "shared", hash: hash(candidate) }]);
	assert.deepEqual(merged.entries.map(({ name, kind, hash: entryHash }) => ({ name, kind, entryHash })), [{
		name: "shared",
		kind: "function",
		entryHash: hash(current),
	}]);
	const repeated = mergeProjectState({
		baseline: merged.baseline,
		current: manifest,
		candidate: projectCandidate(candidate),
		candidatePayload: candidate,
		currentPayload: current,
	});
	assert.deepEqual(repeated.conflicts, []);
	assert.equal(repeated.payload.toString(), "current");
});

test("project notebook merge treats metadata edits as concurrent changes", () => {
	const payload = Buffer.from("same");
	const merged = mergeProjectState({
		baseline: { generation: "base-generation", entries: [{ name: "shared", hash: hash(payload), description: "base" }] },
		current: projectManifest("current-generation", payload, false, { description: "current" }),
		candidate: projectCandidate(payload, "function", { description: "candidate" }),
		candidatePayload: payload,
		currentPayload: payload,
	});

	assert.deepEqual(merged.conflicts, ["shared"]);
	assert.equal(merged.payload.toString(), "same");
	assert.equal(merged.entries[0]?.description, "current");
});

test("project notebook merge preserves pins and validates explicit hook updates", () => {
	const previous = Buffer.from("previous");
	const payload = Buffer.from("value");
	const merged = mergeProjectState({
		baseline: { generation: "current", entries: [{ name: "shared", hash: hash(previous) }] },
		current: projectManifest("current", previous, true),
		candidate: projectCandidate(payload, "value"),
		candidatePayload: payload,
		currentPayload: previous,
	});

	assert.equal(merged.entries[0]?.pinned, true);
	assert.equal(merged.payload.toString(), "value");

	const current = projectManifest("current", payload, true);
	const options = {
		baseline: { generation: "current", entries: [{ name: "shared", hash: hash(payload) }] },
		current,
		candidate: projectCandidate(payload),
		candidatePayload: payload,
		currentPayload: payload,
	};
	const enabled = mergeProjectState({ ...options, pins: { names: ["shared"], pinned: true, hook: "tool_result" } });
	assert.equal(enabled.changed, true);
	assert.equal(enabled.entries[0]?.hook, "tool_result");
	current.entries = enabled.entries;
	assert.equal(mergeProjectState(options).entries[0]?.hook, "tool_result");
	const changed = mergeProjectState({ ...options, pins: { names: ["shared"], pinned: true, hook: "startup" } });
	assert.equal(changed.entries[0]?.hook, "startup");
	for (const pins of [{ names: ["shared"], pinned: false }, { names: ["shared"], pinned: true, hook: false as const }]) {
		const disabled = mergeProjectState({ ...options, pins });
		assert.equal(disabled.changed, true);
		assert.equal(disabled.entries[0]?.hook, undefined);
	}
	assert.throws(() => mergeProjectState({ ...options, candidate: projectCandidate(previous, "value"), candidatePayload: previous }), /require a pinned function/);
	assert.throws(() => mergeProjectState({
		...options,
		candidate: { ...options.candidate, entries: [], skipped: [{ name: "shared", reason: "native function" }] },
		pins: { names: ["shared"], pinned: true, hook: "startup" },
	}), /require a captured function/);
});

test("stale session recovery cannot overwrite a newer project generation", () => {
	const project = { generation: "new", entries: [{ name: "shared", hash: "hash" }] };
	assert.deepEqual(
		[...sessionCheckpointProjectExclusions({ projectGeneration: "old", projectNames: ["deleted"] }, project)],
		["shared", "deleted"],
	);
	assert.deepEqual([...sessionCheckpointProjectExclusions({ projectGeneration: "new" }, project)], []);
});

function projectCandidate(payload: Buffer, kind: "value" | "function" = "function", metadata: { description?: string; usage?: string } = {}): ProjectStateCandidate {
	return {
		deno: "2.9.5",
		v8: "test",
		entries: [{ name: "shared", kind, offset: 0, length: payload.length, ...metadata }],
		skipped: [],
	};
}

function projectManifest(generation: string, payload: Buffer, pinned = false, metadata: { description?: string; usage?: string } = {}): ProjectStateManifest {
	return {
		schema: 1,
		project: "/project",
		generation,
		deno: "2.9.5",
		v8: "test",
		payload: "project-test.bin",
		createdAt: "2026-01-01T00:00:00.000Z",
		sourceSession: "session",
		entries: [{
			name: "shared",
			kind: "function",
			offset: 0,
			length: payload.length,
			hash: hash(payload),
			...metadata,
			...(pinned ? { pinned: true } : {}),
		}],
		skipped: [],
	};
}

function hash(payload: Buffer): string {
	return createHash("sha256").update(payload).digest("hex");
}
