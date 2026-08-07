import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveNotebookProject } from "../src/tools/notebook-mode/project-identity.ts";

test("Notebook session state follows the Git worktree root across package directories", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-notebook-project-"));
	try {
		writeFileSync(join(root, ".git"), "gitdir: /tmp/example\n");
		const nested = join(root, "packages", "example");
		mkdirSync(nested, { recursive: true });
		assert.equal(resolveNotebookProject(nested), root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
