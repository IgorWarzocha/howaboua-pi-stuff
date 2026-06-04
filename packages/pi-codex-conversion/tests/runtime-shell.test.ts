import test from "node:test";
import assert from "node:assert/strict";
import { getCodexShellArgs } from "../src/adapter/runtime-shell.ts";

test("getCodexShellArgs uses POSIX shell flags for bash-compatible shells", () => {
	assert.deepEqual(getCodexShellArgs("/bin/bash", "echo hi", true), ["-lc", "echo hi"]);
	assert.deepEqual(getCodexShellArgs("/bin/bash", "echo hi", false), ["-c", "echo hi"]);
});

test("getCodexShellArgs preserves Windows shell invocation semantics", () => {
	assert.deepEqual(getCodexShellArgs("C:\\Windows\\System32\\cmd.exe", "echo hi", true), ["/d", "/s", "/c", "echo hi"]);
	assert.deepEqual(getCodexShellArgs("powershell.exe", "Write-Output hi", true), ["-NoLogo", "-NoProfile", "-Command", "Write-Output hi"]);
	assert.deepEqual(getCodexShellArgs("pwsh", "Write-Output hi", false), ["-NoLogo", "-NoProfile", "-Command", "Write-Output hi"]);
});
