import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { refFromReport, labelArgs } from "../src/capture.mjs";

test("capture never infers identity from cwd, transcript, or malformed payloads", () => {
	for (const report of [
		null,
		[],
		"id",
		{},
		{ cwd: "/tmp" },
		{ transcript_path: "/tmp/transcript.jsonl" },
		{ session_path: "/tmp/transcript.jsonl" },
		{ session_id: "-bad" },
		{ session_id: 1 },
		{ session_id: "bad\n" },
	]) {
		assert.equal(refFromReport("claude", report), null);
	}
	assert.throws(() => labelArgs("server/t1", "pi", {}, true), /local terminal/);
	assert.throws(() => labelArgs("-t1", "pi", {}, true), /local terminal/);
	assert.throws(() => labelArgs("t1", "custom", {}, true), /unsupported/);
	assert.throws(() => labelArgs("t1", "pi", {}), /native session/);
	assert.equal(refFromReport("letta", { conversation_id: "default" }), null);
});

test("capture CLI never contacts Core for invalid input or an inherited Codex identity", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "herdr-capture-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const hc = join(dir, "hc");
	const marker = join(dir, "contacted");
	writeFileSync(
		hc,
		`#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "");\n`,
		{ mode: 0o755 },
	);
	const script = fileURLToPath(new URL("../src/capture.mjs", import.meta.url));
	const run = (agent, input, overrides = {}) =>
		spawnSync(process.execPath, [script, agent], {
			input,
			encoding: "utf8",
			env: {
				...process.env,
				HC_TERMINAL_ID: "t7",
				HERDR_STATE_HC: hc,
				CODEX_THREAD_ID: "",
				...overrides,
			},
		});
	for (const [input, error] of [
		["broken", /JSON/],
		["{}", /native session identity/],
	]) {
		const result = run("pi", input);
		assert.equal(result.status, 1);
		assert.match(result.stderr, error);
	}
	for (const result of [
		run("pi", "not parsed", { HC_TERMINAL_ID: "" }),
		run("codex", '{"session_id":"child"}', { CODEX_THREAD_ID: "parent" }),
	]) {
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
	}
	assert.equal(existsSync(marker), false);
});
