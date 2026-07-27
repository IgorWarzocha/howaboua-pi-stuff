import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBundledPathToolsEnv, CUSTOM_RUST_BINARIES_DIR_ENV, getBundledPathToolBinaryPath } from "../src/tools/path/binary.ts";

test("custom Rust binaries override individual tools and preserve bundled fallback", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-codex-binaries-"));
	try {
		const executable = process.platform === "win32" ? "exec_bridge.exe" : "exec_bridge";
		const customExecBridge = join(directory, executable);
		writeFileSync(customExecBridge, "custom");

		assert.equal(getBundledPathToolBinaryPath("exec_bridge", {}, directory), customExecBridge);
		assert.equal(getBundledPathToolBinaryPath("view_image", {}, directory), getBundledPathToolBinaryPath("view_image"));
		assert.equal(createBundledPathToolsEnv({}, directory)[CUSTOM_RUST_BINARIES_DIR_ENV], directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
