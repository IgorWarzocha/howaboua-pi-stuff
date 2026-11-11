import {
	lstat,
	mkdtemp,
	readdir,
	rename,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";

const missing = (error: unknown) =>
	error instanceof Error && "code" in error && error.code === "ENOENT";

interface StartupLock {
	handoff(pid: number): Promise<{ path: string; marker: string }>;
	release(): Promise<void>;
}

export function pause(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, 25);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
}

/** Filesystem sockets need stale recovery; a populated directory is atomic election.
 * Never rename a stale lock: another client might already have replaced it.
 */
export async function lockStartup(
	path: string,
	signal: AbortSignal,
): Promise<StartupLock> {
	const lock = `${path}.starting`;
	const candidate = await mkdtemp(`${lock}-${process.pid}-`);
	const owner = `${process.pid}-${candidate.slice(candidate.lastIndexOf("-") + 1)}`;
	await writeFile(`${candidate}/${owner}`, "", { mode: 0o600 });
	try {
		for (;;) {
			signal.throwIfAborted();
			try {
				await rename(candidate, lock);
				break;
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						["ENOTEMPTY", "EEXIST"].includes(String(error.code))
					)
				)
					throw error;
			}
			try {
				const entries = await readdir(lock);
				const previous = entries.length === 1 ? entries[0] : undefined;
				if (previous && /^[1-9][0-9]*-[a-zA-Z0-9]+$/.test(previous)) {
					let dead = false;
					try {
						process.kill(Number(previous.split("-")[0]), 0);
					} catch (error) {
						if (
							error instanceof Error &&
							"code" in error &&
							error.code === "ESRCH"
						)
							dead = true;
					}
					if (dead) await unlink(`${lock}/${previous}`);
				}
				// A published lock is never empty. Recover a crash during removal,
				// without removing a concurrently published populated replacement.
				if (!entries.length && Date.now() - (await lstat(lock)).mtimeMs > 1000)
					await rmdir(lock);
				if (previous) {
					try {
						await rmdir(lock);
					} catch (error) {
						if (
							!(
								error instanceof Error &&
								"code" in error &&
								["ENOTEMPTY", "ENOENT"].includes(String(error.code))
							)
						)
							throw error;
					}
				}
			} catch (error) {
				if (!missing(error)) throw error;
			}
			await pause(signal);
		}
	} catch (error) {
		await unlink(`${candidate}/${owner}`);
		await rmdir(candidate);
		throw error;
	}
	return {
		async handoff(pid) {
			const marker = `${pid}-${owner.slice(owner.indexOf("-") + 1)}`;
			// The directory stays populated throughout transfer. A child must
			// verify this marker before binding, even if its parent has exited.
			await rename(`${lock}/${owner}`, `${lock}/${marker}`);
			return { path: lock, marker };
		},
		async release() {
			await unlink(`${lock}/${owner}`).catch((error: unknown) => {
				if (!missing(error)) throw error;
			});
			await rmdir(lock).catch((error: unknown) => {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						["ENOTEMPTY", "ENOENT"].includes(String(error.code))
					)
				)
					throw error;
			});
		},
	};
}
