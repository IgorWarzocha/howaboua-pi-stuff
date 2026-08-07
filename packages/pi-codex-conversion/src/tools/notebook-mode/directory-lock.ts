import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	lstatSync,
	readdirSync,
	rmdirSync,
	unlinkSync,
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
			writeFileSync(join(path, owner), `${process.pid}\n${Date.now()}\n`, { mode: 0o600 });
			return { release: () => releaseDirectoryLock(path, owner) };
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
		for (const owner of observedOwners) {
			try { unlinkSync(join(path, owner)); } catch {}
		}
		try { rmdirSync(path); } catch {}
	} catch {}
}

function releaseDirectoryLock(path: string, owner: string): void {
	try { unlinkSync(join(path, owner)); } catch {}
	try { rmdirSync(path); } catch {}
}

function isAlreadyExists(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}
