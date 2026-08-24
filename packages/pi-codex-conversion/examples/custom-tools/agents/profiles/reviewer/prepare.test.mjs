import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepare } from "./prepare.mjs";

function git(cwd, ...args) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("review preparation derives the current branch scope", (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "agents-review-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.name", "Test");
	git(cwd, "config", "user.email", "test@example.com");
	writeFileSync(join(cwd, "file.txt"), "one\n");
	git(cwd, "add", "file.txt");
	git(cwd, "commit", "-m", "Initial");
	git(cwd, "switch", "-c", "feature");
	writeFileSync(join(cwd, "file.txt"), "two\n");

	const message = prepare({ cwd, message: "Review the behavior", base: "main" });
	assert.match(message, /Current ref: feature/);
	assert.match(message, /Scope: base-diff/);
	assert.match(message, /Base branch: main/);
	assert.match(message, /Instructions:\nReview the behavior/);
});
