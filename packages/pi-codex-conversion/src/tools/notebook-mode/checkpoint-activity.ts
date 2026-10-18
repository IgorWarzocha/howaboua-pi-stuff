import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checkpointPaths, type NotebookCheckpointIdentity } from "./checkpoint-format.ts";
import { acquireDirectoryLock } from "./directory-lock.ts";

export interface NotebookCheckpointActivity {
	touch(): void;
	release(): void;
}

function notebookStorageDirectory(agentDir: string): string {
	return join(agentDir, "cache", "pi-codex-conversion", "notebook-mode");
}

function directoryEntries(path: string) {
	try { return readdirSync(path, { withFileTypes: true }); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function removeEmptyActivityDirectory(path: string): void {
	try { rmdirSync(path); } catch (error) {
		if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
	}
}

async function retentionLock(agentDir: string) {
	const root = notebookStorageDirectory(agentDir);
	mkdirSync(root, { recursive: true });
	return acquireDirectoryLock(join(root, "checkpoint-retention.lock"), {
		waitMs: 10_000, staleMs: 30_000, pollMs: 20,
	});
}

// Held for the Pi session, not just its lazy kernel. Multiple processes may resume the same identity.
export async function activateNotebookCheckpoint(identity: NotebookCheckpointIdentity): Promise<NotebookCheckpointActivity> {
	const directory = checkpointPaths(identity).directory;
	const lock = await retentionLock(identity.agentDir);
	try {
		const activityDirectory = join(notebookStorageDirectory(identity.agentDir), "active-sessions", basename(directory));
		mkdirSync(activityDirectory, { recursive: true });
		const owner = join(activityDirectory, `active-${process.pid}-${randomUUID()}`);
		const used = join(directory, "last-used");
		writeFileSync(owner, "", { mode: 0o600 });
		const touch = () => {
			try { if (existsSync(directory)) writeFileSync(used, "", { mode: 0o600 }); } catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		};
		try { touch(); } catch (error) {
			rmSync(owner, { force: true });
			removeEmptyActivityDirectory(activityDirectory);
			throw error;
		}
		let released = false;
		return {
			touch: () => { if (!released) touch(); },
			release: () => {
				if (released) return;
				// Last use precedes removal of our protection, including long-idle live sessions.
				touch();
				rmSync(owner, { force: true });
				removeEmptyActivityDirectory(activityDirectory);
				released = true;
			},
		};
	} finally { lock?.release(); }
}

export async function expireNotebookSessionCheckpoints(agentDir: string, retentionAge: () => number | undefined, now = Date.now()): Promise<void> {
	const root = join(notebookStorageDirectory(agentDir), "sessions");
	const activityRoot = join(notebookStorageDirectory(agentDir), "active-sessions");
	if (!existsSync(root) && !existsSync(activityRoot)) return;
	const lock = await retentionLock(agentDir);
	try {
		const active = new Set<string>();
		for (const entry of directoryEntries(activityRoot)) {
			if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
			const directory = join(activityRoot, entry.name);
			for (const file of directoryEntries(directory)) {
				const owner = file.name.match(/^active-([1-9][0-9]*)-[a-f0-9-]{36}$/);
				if (!owner) continue;
				try { process.kill(Number(owner[1]), 0); active.add(entry.name); } catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") rmSync(join(directory, file.name), { force: true });
					else active.add(entry.name);
				}
			}
			removeEmptyActivityDirectory(directory);
		}
		if (retentionAge() === undefined || !existsSync(root)) return;
		for (const entry of directoryEntries(root)) {
			if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
			if (active.has(entry.name)) continue;
			const directory = join(root, entry.name);
			// Legacy checkpoints have no activity file; their latest actual checkpoint write is the baseline.
			const activity = join(directory, "last-used");
			const manifest = join(directory, "checkpoint.json");
			let modified: number;
			try {
				modified = Math.max(
					existsSync(activity) ? statSync(activity).mtimeMs : 0,
					existsSync(manifest) ? statSync(manifest).mtimeMs : statSync(directory).mtimeMs,
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			const maxAgeMs = retentionAge();
			if (maxAgeMs === undefined) return;
			if (now - modified >= maxAgeMs) {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	} finally { lock?.release(); }
}
