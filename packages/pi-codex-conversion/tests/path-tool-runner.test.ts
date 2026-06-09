import { strict as assert } from "node:assert";
import { delimiter } from "node:path";
import { test } from "node:test";
import { createBundledPathToolsEnv, getBundledPathToolsBinDir } from "../src/tools/path/binary.ts";

test("createBundledPathToolsEnv prepends bundled bin without mutating base env", () => {
	const base = { PATH: "/usr/bin" };
	const env = createBundledPathToolsEnv(base);
	assert.equal(base.PATH, "/usr/bin");
	assert.equal(env["PATH"]?.split(delimiter)[0], getBundledPathToolsBinDir());
});
