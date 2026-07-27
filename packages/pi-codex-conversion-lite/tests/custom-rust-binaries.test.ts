import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBundledToolBinaryPath } from "../src/tools/native/binary.ts";

test("custom Rust binaries override individual tools and preserve bundled fallback", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-codex-lite-binaries-"));
	try {
		const executable = process.platform === "win32" ? "exec_bridge.exe" : "exec_bridge";
		const customExecBridge = join(directory, executable);
		writeFileSync(customExecBridge, "custom");

		assert.equal(getBundledToolBinaryPath("exec_bridge", {}, directory), customExecBridge);
		assert.equal(getBundledToolBinaryPath("view_image", {}, directory), getBundledToolBinaryPath("view_image"));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
