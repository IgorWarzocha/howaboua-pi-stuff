import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBundledToolBinaryPath } from "../src/tools/native/binary.ts";
import { resolveVoiceHelperBinary } from "../src/voice/binary.ts";

test("custom Rust binaries override individual tools and preserve bundled fallback", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-codex-lite-binaries-"));
	try {
		const executable = process.platform === "win32" ? "exec_bridge.exe" : "exec_bridge";
		const customExecBridge = join(directory, executable);
		writeFileSync(customExecBridge, "custom");
		const voiceExecutable = process.platform === "win32" ? "pi-codex-voice.exe" : "pi-codex-voice";
		const customVoiceHelper = join(directory, voiceExecutable);
		writeFileSync(customVoiceHelper, "custom");
		if (process.platform !== "win32") chmodSync(customVoiceHelper, 0o755);

		assert.equal(getBundledToolBinaryPath("exec_bridge", {}, directory), customExecBridge);
		assert.equal(getBundledToolBinaryPath("view_image", {}, directory), getBundledToolBinaryPath("view_image"));
		assert.equal(resolveVoiceHelperBinary(directory), customVoiceHelper);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
