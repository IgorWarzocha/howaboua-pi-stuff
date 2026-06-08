import { strict as assert } from "node:assert";
import { delimiter } from "node:path";
import { test } from "node:test";
import { createBundledPathToolsEnv, getBundledPathToolsBinDir } from "../src/tools/path/binary.ts";
import { runBundledTool } from "../src/tools/path/runner.ts";

test("runBundledTool aborts without leaking binary paths", async () => {
	const controller = new AbortController();
	const promise = runBundledTool({
		binary: "/bin/sh",
		args: ["-c", "sleep 5"],
		cwd: process.cwd(),
		signal: controller.signal,
		label: "imagegen",
	});
	controller.abort();
	await assert.rejects(promise, (error) => {
		assert.equal(error instanceof Error ? error.message : String(error), "Operation aborted");
		return true;
	});
});


test("createBundledPathToolsEnv prepends bundled bin without mutating base env", () => {
	const base = { PATH: "/usr/bin" };
	const env = createBundledPathToolsEnv(base);
	assert.equal(base.PATH, "/usr/bin");
	assert.equal(env["PATH"]?.split(delimiter)[0], getBundledPathToolsBinDir());
});
