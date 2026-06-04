import test from "node:test";
import assert from "node:assert/strict";
import { splitEditorCommand } from "../src/codex-settings/config-editor.ts";

test("splitEditorCommand preserves Windows path backslashes", () => {
	assert.deepEqual(splitEditorCommand(String.raw`C:\Windows\notepad.exe`, "win32"), [String.raw`C:\Windows\notepad.exe`]);
	assert.deepEqual(splitEditorCommand(String.raw`"C:\Program Files\Editor\editor.exe" --wait`, "win32"), [
		String.raw`C:\Program Files\Editor\editor.exe`,
		"--wait",
	]);
});

test("splitEditorCommand supports POSIX backslash escapes", () => {
	assert.deepEqual(splitEditorCommand(String.raw`vim\ editor --wait`, "linux"), ["vim editor", "--wait"]);
});
