import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	assertProfileName,
	assertSafeProfileDirectory,
	profileStatePaths,
	readProfileStateManifest,
} from "../src/tools/notebook-mode/profile-state-format.ts";

test("notebook profile names cannot escape global profile storage", () => {
	for (const name of ["../shell", "/shell", "shell/profile", ".hidden", ""]) {
		assert.throws(() => assertProfileName(name));
	}
});

test("notebook profiles reject moved manifests and symlinked storage", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-profile-format-"));
	try {
		const shell = profileStatePaths("shell", agentDir);
		mkdirSync(shell.directory, { recursive: true });
		writeFileSync(shell.manifest, JSON.stringify({
			schema: 1,
			name: "other",
			deno: "2.9.5",
			v8: "test",
			payload: "profile-00000000-0000-0000-0000-000000000000.bin",
			createdAt: "2026-01-01T00:00:00.000Z",
			sourceProject: "/project",
			entries: [],
			skipped: [],
		}));
		assert.equal(readProfileStateManifest(shell.manifest, "shell"), undefined);

		const outside = join(agentDir, "outside");
		mkdirSync(outside);
		const linked = profileStatePaths("linked", agentDir);
		symlinkSync(outside, linked.directory);
		assert.throws(() => assertSafeProfileDirectory(linked.directory, agentDir), /symlinked path/);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
