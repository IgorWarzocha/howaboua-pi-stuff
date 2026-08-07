import { mkdirSync } from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { dbPathFor, indexLockPathFor } from "./db.js";

export type ReleaseIndexLock = () => Promise<void>;

export async function tryAcquireIndexLock(
	root: string,
): Promise<ReleaseIndexLock | undefined> {
	mkdirSync(path.join(root, ".pi"), { recursive: true });
	try {
		return await lockfile.lock(dbPathFor(root), {
			realpath: false,
			lockfilePath: indexLockPathFor(root),
			stale: 120_000,
			update: 30_000,
			retries: 0,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOCKED") return undefined;
		throw error;
	}
}
