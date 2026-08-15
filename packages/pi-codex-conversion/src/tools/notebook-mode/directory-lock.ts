import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	lstatSync,
	readFileSync,
	readdirSync,
	rmdirSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const OWNER_SUFFIX = ".owner";

export interface DirectoryLock {
	release(): void;
}

export async function acquireDirectoryLock(
	path: string,
	options: {
		waitMs: number;
		staleMs: number;
		pollMs: number;
		signal?: AbortSignal | undefined;
		stopWaiting?: (() => boolean) | undefined;
	},
): Promise<DirectoryLock | undefined> {
	const deadline = Date.now() + options.waitMs;
	const owner = `${process.pid}-${randomUUID()}${OWNER_SUFFIX}`;
	while (Date.now() < deadline) {
		options.signal?.throwIfAborted();
		if (options.stopWaiting?.()) return undefined;
		try {
			mkdirSync(path);
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
			reclaimStaleDirectoryLock(path, options.staleMs);
			await delay(options.pollMs, undefined, options.signal ? { signal: options.signal } : undefined);
			continue;
		}
		try {
			const ownerPath = join(path, owner);
			writeFileSync(ownerPath, `${process.pid}\n${Date.now()}\n`, { mode: 0o600 });
			const heartbeat = setInterval(() => refreshOwner(ownerPath), Math.max(1, Math.floor(options.staleMs / 3)));
			heartbeat.unref();
			return {
				release: () => {
					clearInterval(heartbeat);
					releaseDirectoryLock(path, owner);
				},
			};
		} catch (error) {
			releaseDirectoryLock(path, owner);
			throw error;
		}
	}
	throw new Error(`timed out waiting for lock: ${path}`);
}

function reclaimStaleDirectoryLock(path: string, staleMs: number): void {
	try {
		const stat = lstatSync(path);
		if (Date.now() - stat.mtimeMs <= staleMs) return;
		if (!stat.isDirectory()) {
			try { unlinkSync(path); } catch {}
			return;
		}
		const observedOwners = readdirSync(path).filter((name) => name.endsWith(OWNER_SUFFIX));
		if (observedOwners.some((owner) => ownerIsFreshOrLive(join(path, owner), staleMs))) return;
		for (const owner of observedOwners) {
			try { unlinkSync(join(path, owner)); } catch {}
		}
		try { rmdirSync(path); } catch {}
	} catch {}
}

function refreshOwner(path: string): void {
	try {
		const now = new Date();
		utimesSync(path, now, now);
	} catch {}
}

function ownerIsFreshOrLive(path: string, staleMs: number): boolean {
	try {
		if (Date.now() - lstatSync(path).mtimeMs <= staleMs) return true;
		const pid = Number.parseInt(readFileSync(path, "utf8").split("\n", 1)[0]!, 10);
		if (!Number.isSafeInteger(pid) || pid <= 0) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return error instanceof Error && "code" in error && error.code === "EPERM";
		}
	} catch {
		return false;
	}
}

function releaseDirectoryLock(path: string, owner: string): void {
	try { unlinkSync(join(path, owner)); } catch {}
	try { rmdirSync(path); } catch {}
}

function isAlreadyExists(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}
