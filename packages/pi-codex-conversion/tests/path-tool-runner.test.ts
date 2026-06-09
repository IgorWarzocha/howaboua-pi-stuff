import { strict as assert } from "node:assert";
import { delimiter } from "node:path";
import { test } from "node:test";
import { createBundledPathToolsEnv, getBundledPathToolsBinDir } from "../src/tools/path/binary.ts";
import { convertPathToolExecResult, getPathToolPolicy } from "../src/tools/path/outputs.ts";

test("createBundledPathToolsEnv prepends bundled bin without mutating base env", () => {
	const base = { PATH: "/usr/bin" };
	const env = createBundledPathToolsEnv(base);
	assert.equal(base.PATH, "/usr/bin");
	assert.equal(env["PATH"]?.split(delimiter)[0], getBundledPathToolsBinDir());
});

test("PATH apply_patch results omit heredoc command while preserving output", () => {
	const command = `apply_patch <<'PATCH'
*** Begin Patch
*** Update File: notes.md
@@
-old
+new
*** End Patch
PATCH
sed -n '1,20p' notes.md`;
	const policy = getPathToolPolicy(command, undefined);
	const converted = convertPathToolExecResult(command, {
		chunk_id: "abc123",
		wall_time_seconds: 0.01,
		exit_code: 0,
		original_token_count: 42,
		output: "Success. Updated the following files:\nM notes.md\nnew\n",
	}, policy);

	assert.ok(converted);
	const text = converted.content[0]?.type === "text" ? converted.content[0].text : "";
	assert.doesNotMatch(text, /Command:/);
	assert.doesNotMatch(text, /Begin Patch/);
	assert.doesNotMatch(text, /Original token count/);
	assert.doesNotMatch(text, /Wall time/);
	assert.match(text, /Success\. Updated the following files/);
	assert.match(text, /new/);
});

test("PATH apply_patch failure keeps error output but omits patch command", () => {
	const command = `apply_patch <<'PATCH'
*** Begin Patch
*** Update File: missing.md
@@
-old
+new
*** End Patch
PATCH`;
	const policy = getPathToolPolicy(command, undefined);
	const converted = convertPathToolExecResult(command, {
		chunk_id: "abc123",
		wall_time_seconds: 0.01,
		exit_code: 1,
		output: "Failed to read file to update missing.md\n",
	}, policy);

	assert.ok(converted);
	const text = converted.content[0]?.type === "text" ? converted.content[0].text : "";
	assert.doesNotMatch(text, /Command:/);
	assert.doesNotMatch(text, /Begin Patch/);
	assert.match(text, /Process exited with code 1/);
	assert.match(text, /Failed to read file to update missing\.md/);
});
