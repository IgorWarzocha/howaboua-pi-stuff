import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mergeProjectState } from "../src/tools/notebook-mode/project-state-merge.ts";
import type {
	ProjectStateCandidate,
	ProjectStateManifest,
} from "../src/tools/notebook-mode/project-state-format.ts";

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
	assert.deepEqual(merged.entries.map(({ name, kind, hash: entryHash }) => ({ name, kind, entryHash })), [{
		name: "shared",
		kind: "function",
		entryHash: hash(current),
	}]);
});

test("project notebook merge applies an uncontested plain global", () => {
	const payload = Buffer.from("value");
	const merged = mergeProjectState({
		baseline: { generation: "root", entries: [] },
		candidate: projectCandidate(payload, "value"),
		candidatePayload: payload,
		currentPayload: Buffer.alloc(0),
	});

	assert.equal(merged.changed, true);
	assert.deepEqual(merged.conflicts, []);
	assert.deepEqual(merged.appliedNames, ["shared"]);
	assert.equal(merged.payload.toString(), "value");
});

function projectCandidate(payload: Buffer, kind: "value" | "function" = "function"): ProjectStateCandidate {
	return {
		deno: "2.9.5",
		v8: "test",
		entries: [{ name: "shared", kind, offset: 0, length: payload.length }],
		skipped: [],
	};
}

function projectManifest(generation: string, payload: Buffer): ProjectStateManifest {
	return {
		schema: 1,
		project: "/project",
		generation,
		deno: "2.9.5",
		v8: "test",
		payload: "project-test.bin",
		createdAt: "2026-01-01T00:00:00.000Z",
		sourceSession: "session",
		entries: [{ name: "shared", kind: "function", offset: 0, length: payload.length, hash: hash(payload) }],
		skipped: [],
	};
}

function hash(payload: Buffer): string {
	return createHash("sha256").update(payload).digest("hex");
}
