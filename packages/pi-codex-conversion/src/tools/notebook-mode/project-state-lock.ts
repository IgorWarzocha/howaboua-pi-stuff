import { acquireDirectoryLock } from "./directory-lock.ts";

const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 5_000;

export async function withProjectStateLock<T>(
	path: string,
	operation: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	const lock = await acquireDirectoryLock(path, {
		waitMs: LOCK_WAIT_MS,
		staleMs: LOCK_STALE_MS,
		pollMs: 50,
		signal,
	});
	if (!lock)
		throw new Error("Project notebook checkpoint lock became unavailable");
	try {
		return await operation();
	} finally {
		lock.release();
	}
}
