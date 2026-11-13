import { randomUUID } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import {
	planSparsePruning,
	scanSparseSource,
} from "./session-pruning-sparse.mjs";
import { cleanupPaths, tryCleanupLock } from "./session-pruning-state.mjs";

/** @param {string} path @param {import("node:fs").Stats} source */
function checkSource(path, source) {
	const current = lstatSync(path);
	if (
		!current.isFile() ||
		current.nlink !== 1 ||
		current.dev !== source.dev ||
		current.ino !== source.ino ||
		current.size !== source.size ||
		current.mtimeMs !== source.mtimeMs ||
		current.ctimeMs !== source.ctimeMs
	)
		throw new Error(
			"Session changed during cleanup. Nothing was replaced. Cleanup will retry on the next normal Pi exit.",
		);
}

/** Open descriptors supplement the registered session owners, not replace them.
 * @param {import("node:fs").Stats} source
 */
function checkHolders(source) {
	if (process.platform !== "linux")
		throw new Error(
			"Automatic session cleanup is unavailable on this platform. Retired payloads remain pruned.",
		);
	const holders = new Set();
	for (const pid of readdirSync("/proc")) {
		if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
		const dir = `/proc/${pid}`;
		try {
			if (statSync(dir).uid !== process.getuid?.()) continue;
			for (const fd of readdirSync(`${dir}/fd`)) {
				try {
					const file = statSync(`${dir}/fd/${fd}`);
					if (file.dev === source.dev && file.ino === source.ino)
						holders.add(pid);
				} catch (error) {
					if (!vanished(error)) throw error;
				}
			}
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				(error.code === "EACCES" || error.code === "EPERM")
			)
				continue;
			else if (!vanished(error))
				throw new Error(
					`Cannot inspect open holders for PID ${pid}: ${String(error)}`,
				);
		}
	}
	if (holders.size)
		throw new Error(
			`Session record cleanup was skipped because process(es) ${[...holders].join(", ")} still hold it open. It will retry on the next normal Pi exit.`,
		);
}

/** @param {unknown} error */
function vanished(error) {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ESRCH")
	);
}

/** Called only by the after-exit worker.
 * @param {string} file @param {string} sessionId @param {()=>void} checkOwners
 */
export async function cleanSparseSession(file, sessionId, checkOwners) {
	const path = resolve(file);
	const source = lstatSync(path);
	if (!source.isFile() || source.nlink !== 1)
		throw new Error(
			"Session record cleanup requires a regular session file without symbolic or hard links. Retired payloads remain pruned.",
		);
	checkOwners();
	checkHolders(source);
	const lock = cleanupPaths(path).lock;
	let releaseLock;
	const temp = `${path}.notes-prune-${randomUUID()}.tmp`;
	/** @type {Awaited<ReturnType<typeof open>>|undefined} */
	let output;
	try {
		releaseLock = tryCleanupLock(path);
		if (!releaseLock)
			throw new Error(
				`Another session cleanup may be running. Only after verifying that none is active, remove the stale lock ${JSON.stringify(lock)}. Cleanup will retry on the next normal Pi exit. Do not remove an active cleanup's lock.`,
			);
		checkOwners();
		const plan = await planSparsePruning(path, source.size);
		if (plan.header.id !== sessionId)
			throw new Error("Session identity changed. Cleanup was skipped.");
		checkSource(path, source);
		if (!plan.removed.size)
			return { removed: 0, before: source.size, after: source.size };
		output = await open(temp, "wx", source.mode & 0o777);
		const target = output;
		const generation = randomUUID();
		await scanSparseSource(path, source.size, async (entry, raw) => {
			if (plan.removed.has(entry.id)) return;
			const parentId = plan.parents.get(entry.id) ?? null;
			const replacement =
				entry.type === "session"
					? {
							...entry,
							notesPruning: { version: 1, sessionId: entry.id, generation },
						}
					: entry.parentId === parentId
						? entry
						: { ...entry, parentId };
			await target.writeFile(
				`${replacement === entry ? raw : JSON.stringify(replacement)}\n`,
			);
		});
		await output.sync();
		await output.close();
		output = undefined;
		// No await from final holder/source validation through atomic replacement.
		checkOwners();
		checkHolders(source);
		checkSource(path, source);
		const after = statSync(temp).size;
		renameSync(temp, path);
		const directory = openSync(resolve(path, ".."), "r");
		try {
			fsyncSync(directory);
		} finally {
			closeSync(directory);
		}
		return { removed: plan.removed.size, before: source.size, after };
	} finally {
		await output?.close();
		try {
			unlinkSync(temp);
		} catch (error) {
			if (!vanished(error)) throw error;
		} finally {
			releaseLock?.();
		}
	}
}
