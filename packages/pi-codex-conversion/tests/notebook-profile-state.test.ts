import assert from "node:assert/strict";
import test from "node:test";
import {
	assertProfileName,
	profileStatePaths,
} from "../src/tools/notebook-mode/profile-state-format.ts";

test("notebook profile names cannot escape global profile storage", () => {
	assert.equal(
		profileStatePaths("shell-agent", "/agent").manifest,
		"/agent/cache/pi-codex-conversion/notebook-mode/profiles/shell-agent/profile.json",
	);
	for (const name of ["../shell", "/shell", "shell/profile", ".hidden", ""]) {
		assert.throws(() => assertProfileName(name));
	}
});
