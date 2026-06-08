import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executePatch, patchFsOps } from "../src/patch/core.ts";
import { ExecutePatchError } from "../src/patch/types.ts";

test("executePatch updates, adds, and moves files inside cwd", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "alpha.txt"), "old line\nkeep line\n", "utf8");
		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: alpha.txt
*** Move to: moved/alpha.txt
@@
-old line
+new line
 keep line
*** Add File: beta.txt
+hello beta
*** End Patch`,
		});

		assert.deepEqual(result.changedFiles.sort(), ["alpha.txt", "beta.txt", "moved/alpha.txt"].sort());
		assert.deepEqual(result.createdFiles.sort(), ["beta.txt", "moved/alpha.txt"].sort());
		assert.deepEqual(result.deletedFiles, ["alpha.txt"]);
		assert.deepEqual(result.movedFiles, ["alpha.txt -> moved/alpha.txt"]);
		assert.equal(readFileSync(join(cwd, "moved/alpha.txt"), "utf8"), "new line\nkeep line\n");
		assert.equal(readFileSync(join(cwd, "beta.txt"), "utf8"), "hello beta\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch resolves relative paths against cwd", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Add File: nested/relative.txt
+hello relative
*** End Patch`,
		});

		assert.deepEqual(result.changedFiles, ["nested/relative.txt"]);
		assert.deepEqual(result.createdFiles, ["nested/relative.txt"]);
		assert.equal(readFileSync(join(cwd, "nested/relative.txt"), "utf8"), "hello relative\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch accepts absolute paths as-is", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const absolutePath = join(cwd, "absolute.txt");
	try {
		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Add File: ${absolutePath}
+hello absolute
*** End Patch`,
		});

		assert.deepEqual(result.changedFiles, [absolutePath]);
		assert.deepEqual(result.createdFiles, [absolutePath]);
		assert.equal(readFileSync(absolutePath, "utf8"), "hello absolute\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch rejects empty patches", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		assert.throws(
			() =>
				executePatch({
					cwd,
					patchText: `*** Begin Patch
*** End Patch`,
				}),
			/no files were modified/i,
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch add overwrites an existing file", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "duplicate.txt"), "old content\n", "utf8");

		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Add File: duplicate.txt
+new content
*** End Patch`,
		});

		assert.deepEqual(result.changedFiles, ["duplicate.txt"]);
		assert.deepEqual(result.createdFiles, []);
		assert.equal(readFileSync(join(cwd, "duplicate.txt"), "utf8"), "new content\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch move overwrites an existing destination", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		mkdirSync(join(cwd, "old"), { recursive: true });
		mkdirSync(join(cwd, "renamed/dir"), { recursive: true });
		writeFileSync(join(cwd, "old/name.txt"), "from\n", "utf8");
		writeFileSync(join(cwd, "renamed/dir/name.txt"), "existing\n", "utf8");

		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: old/name.txt
*** Move to: renamed/dir/name.txt
@@
-from
+new
*** End Patch`,
		});

		assert.deepEqual(result.changedFiles.sort(), ["old/name.txt", "renamed/dir/name.txt"].sort());
		assert.deepEqual(result.createdFiles, []);
		assert.deepEqual(result.deletedFiles, ["old/name.txt"]);
		assert.deepEqual(result.movedFiles, ["old/name.txt -> renamed/dir/name.txt"]);
		assert.equal(readFileSync(join(cwd, "renamed/dir/name.txt"), "utf8"), "new\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch update appends a trailing newline", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "no-newline.txt"), "no newline at end", "utf8");

		executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: no-newline.txt
@@
-no newline at end
+first line
+second line
*** End Patch`,
		});

		assert.equal(readFileSync(join(cwd, "no-newline.txt"), "utf8"), "first line\nsecond line\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch leaves earlier changes applied when a later hunk fails", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		let error: unknown;
		try {
			executePatch({
				cwd,
				patchText: `*** Begin Patch
*** Add File: created.txt
+hello
*** Update File: missing.txt
@@
-old
+new
*** End Patch`,
			});
		} catch (caught) {
			error = caught;
		}

		assert.ok(error instanceof ExecutePatchError);
		assert.match(error.message, /file not found|missing file/i);
		assert.deepEqual(error.result.changedFiles, ["created.txt"]);
		assert.deepEqual(error.result.createdFiles, ["created.txt"]);
		assert.equal(error.failedAction?.path, "missing.txt");

		assert.equal(readFileSync(join(cwd, "created.txt"), "utf8"), "hello\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch continues applying later file actions after a failed file action", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		let error: unknown;
		try {
			executePatch({
				cwd,
				patchText: `*** Begin Patch
*** Add File: created.txt
+hello
*** Update File: missing.txt
@@
-old
+new
*** Add File: later.txt
+world
*** End Patch`,
			});
		} catch (caught) {
			error = caught;
		}

		assert.ok(error instanceof ExecutePatchError);
		assert.match(error.message, /file not found|missing file/i);
		assert.deepEqual(error.result.changedFiles.sort(), ["created.txt", "later.txt"]);
		assert.deepEqual(error.result.createdFiles.sort(), ["created.txt", "later.txt"]);
		assert.equal(error.failedAction?.path, "missing.txt");
		assert.equal(error.failures.length, 1);

		assert.equal(readFileSync(join(cwd, "created.txt"), "utf8"), "hello\n");
		assert.equal(readFileSync(join(cwd, "later.txt"), "utf8"), "world\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch skips later actions that overlap a failed move", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const sourcePath = join(cwd, "a.txt");
	const originalUnlinkSync = patchFsOps.unlinkSync;
	try {
		writeFileSync(sourcePath, "from\n", "utf8");
		patchFsOps.unlinkSync = (path) => {
			if (String(path) === sourcePath) {
				throw new Error("mock unlink failure");
			}
			return originalUnlinkSync(path);
		};

		let error: unknown;
		try {
			executePatch({
				cwd,
				patchText: `*** Begin Patch
*** Update File: a.txt
*** Move to: b.txt
@@
-from
+to
*** Update File: b.txt
@@
-to
+to2
*** Add File: c.txt
+later
*** End Patch`,
			});
		} catch (caught) {
			error = caught;
		} finally {
			patchFsOps.unlinkSync = originalUnlinkSync;
		}

		assert.ok(error instanceof ExecutePatchError);
		assert.equal(error.failures.length, 2);
		assert.equal(error.failures[0]!?.action.path, "a.txt");
		assert.equal(error.failures[1]!?.action.path, "b.txt");
		assert.match(error.failures[1]!?.message ?? "", /Skipped because an earlier failed action affected b\.txt/);
		assert.deepEqual(error.result.changedFiles.sort(), ["b.txt", "c.txt"]);
		assert.deepEqual(error.result.createdFiles.sort(), ["b.txt", "c.txt"]);
		assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "from\n");
		assert.equal(readFileSync(join(cwd, "b.txt"), "utf8"), "to\n");
		assert.equal(readFileSync(join(cwd, "c.txt"), "utf8"), "later\n");
	} finally {
		patchFsOps.unlinkSync = originalUnlinkSync;
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch blocks overlapping actions even when they use absolute and relative path aliases", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const sourcePath = join(cwd, "source.txt");
	const movedPath = join(cwd, "moved.txt");
	const originalUnlinkSync = patchFsOps.unlinkSync;
	try {
		writeFileSync(sourcePath, "from\n", "utf8");
		patchFsOps.unlinkSync = (path) => {
			if (String(path) === sourcePath) {
				throw new Error("mock unlink failure");
			}
			return originalUnlinkSync(path);
		};

		let error: unknown;
		try {
			executePatch({
				cwd,
				patchText: `*** Begin Patch
*** Update File: ${sourcePath}
*** Move to: ${movedPath}
@@
-from
+to
*** Update File: ./source.txt
@@
-from
+to2
*** Add File: later.txt
+later
*** End Patch`,
			});
		} catch (caught) {
			error = caught;
		} finally {
			patchFsOps.unlinkSync = originalUnlinkSync;
		}

		assert.ok(error instanceof ExecutePatchError);
		assert.equal(error.failures.length, 2);
		assert.equal(error.failures[0]!?.action.path, sourcePath);
		assert.equal(error.failures[1]!?.action.path, "./source.txt");
		assert.match(error.failures[1]!?.message ?? "", /Skipped because an earlier failed action affected \.\/source\.txt/);
		assert.equal(readFileSync(sourcePath, "utf8"), "from\n");
		assert.equal(readFileSync(movedPath, "utf8"), "to\n");
		assert.equal(readFileSync(join(cwd, "later.txt"), "utf8"), "later\n");
	} finally {
		patchFsOps.unlinkSync = originalUnlinkSync;
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch applies multi-file updates despite whitespace drift in matched lines", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "alpha.txt"), "old line   \nkeep line\n", "utf8");
		writeFileSync(join(cwd, "beta.txt"), "first value\nsecond value   \n", "utf8");

		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: alpha.txt
@@
-old line
+new line
 keep line
*** Update File: beta.txt
@@
 first value
-second value
+second value updated
*** End Patch`,
		});

		assert.deepEqual(result.changedFiles.sort(), ["alpha.txt", "beta.txt"]);
		assert.equal(readFileSync(join(cwd, "alpha.txt"), "utf8"), "new line\nkeep line\n");
		assert.equal(readFileSync(join(cwd, "beta.txt"), "utf8"), "first value\nsecond value updated\n");
		assert.ok(result.fuzz > 0);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch rejects case-mismatched deletions", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "ids.ts"), "const UserID = 1;\n", "utf8");

		let error: unknown;
		try {
			executePatch({
				cwd,
				patchText: `*** Begin Patch
*** Update File: ids.ts
@@
-const userid = 1;
+const userId = 2;
*** End Patch`,
			});
		} catch (caught) {
			error = caught;
		}

		assert.ok(error instanceof ExecutePatchError);
		assert.match(error.message, /Failed to find expected lines in ids\.ts/i);
		assert.deepEqual(error.result.changedFiles, []);
		assert.equal(readFileSync(join(cwd, "ids.ts"), "utf8"), "const UserID = 1;\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch rejects indentation-only mismatched deletions", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "test.py"), 'print("x")\n', "utf8");

		let error: unknown;
		try {
			executePatch({
				cwd,
				patchText: `*** Begin Patch
*** Update File: test.py
@@
-    print("x")
+    print("y")
*** End Patch`,
			});
		} catch (caught) {
			error = caught;
		}

		assert.ok(error instanceof ExecutePatchError);
		assert.match(error.message, /Expected\s+print\("x"\) but got print\("x"\)/i);
		assert.deepEqual(error.result.changedFiles, []);
		assert.equal(readFileSync(join(cwd, "test.py"), "utf8"), 'print("x")\n');
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch prefers a later exact context match over an earlier fuzzy one", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "targets.txt"), "target   \ntarget\n", "utf8");

		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: targets.txt
@@
-target
+chosen
*** End Patch`,
		});

		assert.equal(readFileSync(join(cwd, "targets.txt"), "utf8"), "target   \nchosen\n");
		assert.equal(result.fuzz, 0);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch prefers trimEnd-only context matches over trim-level matches for insertion hunks", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		const context = Array.from({ length: 101 }, (_, index) => `ctx${index}`);
		const earlierTrimLevelMatch = [...context];
		earlierTrimLevelMatch[50] = "  ctx50";
		const laterTrimEndMatch = context.map((line) => `${line}   `);

		writeFileSync(join(cwd, "targets.txt"), ["before-trim", ...earlierTrimLevelMatch, "between", ...laterTrimEndMatch, "after"].join("\n") + "\n", "utf8");

		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: targets.txt
@@
 ${context.slice(0, 50).join("\n ")}
+inserted
 ${context.slice(50).join("\n ")}
*** End Patch`,
		});

		assert.equal(result.fuzz, 101);
		assert.equal(
			readFileSync(join(cwd, "targets.txt"), "utf8"),
			["before-trim", ...earlierTrimLevelMatch, "between", ...laterTrimEndMatch.slice(0, 50), "inserted", ...laterTrimEndMatch.slice(50), "after"].join("\n") + "\n",
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch keeps first-match locality within a fuzzy context tier across sequential hunks", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(
			join(cwd, "targets.txt"),
			[
				"marker",
				"ctx1   ",
				"ctx2   ",
				"first-end",
				"ctx1   ",
				"ctx2",
				"second-end",
			].join("\n") + "\n",
			"utf8",
		);

		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: targets.txt
@@
 marker
+after-marker
@@
 ctx1
 ctx2
+first-match
*** End Patch`,
		});

		assert.equal(result.fuzz, 2);
		assert.equal(
			readFileSync(join(cwd, "targets.txt"), "utf8"),
			[
				"marker",
				"after-marker",
				"ctx1   ",
				"ctx2   ",
				"first-match",
				"first-end",
				"ctx1   ",
				"ctx2",
				"second-end",
			].join("\n") + "\n",
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch prefers trimEnd-only section anchors over trim-level anchors", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(
			join(cwd, "module.py"),
			[
				"class Wrapper:",
				"    def foo():",
				"        pass",
				"",
				"def foo():   ",
				"    pass",
			].join("\n") + "\n",
			"utf8",
		);

		const result = executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: module.py
@@ def foo():
+    inserted = True
*** End Patch`,
		});

		assert.equal(result.fuzz, 1);
		assert.equal(
			readFileSync(join(cwd, "module.py"), "utf8"),
			[
				"class Wrapper:",
				"    def foo():",
				"        pass",
				"",
				"def foo():   ",
				"    inserted = True",
				"    pass",
			].join("\n") + "\n",
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch keeps repeated section headers anchored to the current section", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(
			join(cwd, "module.py"),
			[
				"def foo():",
				"    first = 1",
				"    keep = 2",
				"",
				"def foo():",
				"    first = 10",
				"    keep = 20",
			].join("\n") + "\n",
			"utf8",
		);

		executePatch({
			cwd,
			patchText: `*** Begin Patch
*** Update File: module.py
@@ def foo():
-    first = 1
+    first = 2
@@ def foo():
-    keep = 2
+    keep = 3
*** End Patch`,
		});

		assert.equal(
			readFileSync(join(cwd, "module.py"), "utf8"),
			[
				"def foo():",
				"    first = 2",
				"    keep = 3",
				"",
				"def foo():",
				"    first = 10",
				"    keep = 20",
			].join("\n") + "\n",
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch reports partial move side effects when unlink fails after writing the destination", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const sourcePath = join(cwd, "source.txt");
	const originalUnlinkSync = patchFsOps.unlinkSync;
	try {
		writeFileSync(sourcePath, "from\n", "utf8");
		patchFsOps.unlinkSync = (path) => {
			if (String(path) === sourcePath) {
				throw new Error("mock unlink failure");
			}
			return originalUnlinkSync(path);
		};

		let error: unknown;
		try {
			executePatch({
				cwd,
				patchText: `*** Begin Patch
*** Update File: source.txt
*** Move to: moved/source.txt
@@
-from
+to
*** End Patch`,
			});
		} catch (caught) {
			error = caught;
		} finally {
			patchFsOps.unlinkSync = originalUnlinkSync;
		}

		assert.ok(error instanceof ExecutePatchError);
		assert.deepEqual(error.result.changedFiles, ["moved/source.txt"]);
		assert.deepEqual(error.result.createdFiles, ["moved/source.txt"]);
		assert.deepEqual(error.result.deletedFiles, []);
		assert.deepEqual(error.result.movedFiles, []);
		assert.equal(readFileSync(join(cwd, "moved/source.txt"), "utf8"), "to\n");
		assert.equal(readFileSync(sourcePath, "utf8"), "from\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch rejects an empty update hunk", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		writeFileSync(join(cwd, "foo.txt"), "hello\n", "utf8");
		assert.throws(
			() =>
				executePatch({
					cwd,
					patchText: `*** Begin Patch
*** Update File: foo.txt
*** End Patch`,
				}),
			/empty/i,
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("executePatch rejects invalid hunk headers", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	try {
		assert.throws(
			() =>
				executePatch({
					cwd,
					patchText: `*** Begin Patch
*** Frobnicate File: foo.txt
*** End Patch`,
				}),
			/not a valid hunk header|unknown line/i,
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
