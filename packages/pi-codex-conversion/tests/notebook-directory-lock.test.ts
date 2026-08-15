import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { acquireDirectoryLock } from "../src/tools/notebook-mode/directory-lock.ts";

test("Notebook directory locks reclaim stale owners without deleting replacements", async () => {
	const root = join(tmpdir(), `pi-notebook-lock-${process.pid}-${Date.now()}`);
	const path = join(root, "lock");
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "stale.owner"), "stale\n");
	const old = new Date(Date.now() - 60_000);
	utimesSync(join(path, "stale.owner"), old, old);
	utimesSync(path, old, old);
	try {
		const lock = await acquireDirectoryLock(path, { waitMs: 1_000, staleMs: 1_000, pollMs: 1 });
		assert.ok(lock);
		const [owner] = readdirSync(path);
		assert.match(owner!, /\.owner$/);
		unlinkSync(join(path, owner!));
		rmdirSync(path);
		mkdirSync(path);
		writeFileSync(join(path, "replacement.owner"), "replacement\n");
		lock.release();
		assert.equal(existsSync(join(path, "replacement.owner")), true);
		const legacyPath = join(root, "legacy.lock");
		writeFileSync(legacyPath, "old file lock\n");
		utimesSync(legacyPath, old, old);
		const migrated = await acquireDirectoryLock(legacyPath, { waitMs: 1_000, staleMs: 1_000, pollMs: 1 });
		assert.ok(migrated);
		migrated.release();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Notebook directory locks keep a live lease beyond its stale window", async () => {
	const root = join(tmpdir(), `pi-notebook-live-lock-${process.pid}-${Date.now()}`);
	const path = join(root, "lock");
	let lock: Awaited<ReturnType<typeof acquireDirectoryLock>> = undefined;
	let replacement: Awaited<ReturnType<typeof acquireDirectoryLock>> = undefined;
	mkdirSync(root, { recursive: true });
	try {
		lock = await acquireDirectoryLock(path, { waitMs: 1_000, staleMs: 90, pollMs: 5 });
		assert.ok(lock);
		await delay(220);
		await assert.rejects(
			acquireDirectoryLock(path, { waitMs: 60, staleMs: 90, pollMs: 5 }),
			/timed out waiting for lock/,
		);
		lock.release();
		lock = undefined;
		replacement = await acquireDirectoryLock(path, { waitMs: 1_000, staleMs: 90, pollMs: 5 });
		assert.ok(replacement);
		replacement.release();
		replacement = undefined;
	} finally {
		lock?.release();
		replacement?.release();
		rmSync(root, { recursive: true, force: true });
	}
});
