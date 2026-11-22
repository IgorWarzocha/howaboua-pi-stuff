import test from "node:test";
import assert from "node:assert/strict";
import { resumeArgv } from "../src/resume.mjs";

test("only Pi and OMP accept absolute session paths, kept as one exact argument", () => {
	for (const value of [
		"/tmp/session with spaces's.jsonl",
		"C:\\Sessions\\pi.jsonl",
	]) {
		assert.deepEqual(resumeArgv("pi", { kind: "path", value }), [
			"pi",
			"--session",
			value,
		]);
		assert.deepEqual(resumeArgv("omp", { kind: "path", value }), [
			"omp",
			`--resume=${value}`,
		]);
		assert.equal(resumeArgv("claude", { kind: "path", value }), null);
	}
});

test("untrusted identities cannot add flags or escape length and control limits", () => {
	for (const ref of [
		null,
		{},
		{ kind: "other", value: "abc" },
		...[
			"",
			" ",
			"-x",
			"a\nb",
			"a\u0085b",
			"x".repeat(513),
			"é".repeat(257),
		].map((value) => ({ kind: "id", value })),
		{ kind: "path", value: "relative.jsonl" },
		{ kind: "path", value: "/" + "x".repeat(4096) },
		{ kind: "id", value: 123 },
	]) {
		assert.equal(resumeArgv("pi", ref), null);
	}
	assert.equal(resumeArgv("custom", { kind: "id", value: "abc" }), null);
	for (const value of ["default:", "default:-x"]) {
		assert.equal(resumeArgv("letta", { kind: "id", value }), null);
	}
	// Shell metacharacters remain data. The caller must execute/quote argv, never join it.
	assert.deepEqual(
		resumeArgv("claude", { kind: "id", value: "$(touch bad); hi" }),
		["claude", "--resume", "$(touch bad); hi"],
	);
});
