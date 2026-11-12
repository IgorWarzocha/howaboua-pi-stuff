import { createHash } from "node:crypto";
import {
	closeSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	realpathSync,
	unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/** @param {string} root */
function privateRoot(root) {
	const stat = lstatSync(root);
	if (
		!stat.isDirectory() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o077) !== 0
	)
		throw new Error(
			`Session cleanup state ${JSON.stringify(root)} must be a private directory owned by this user. Restore its ownership/permissions before restarting Pi.`,
		);
}

/** Exact-file coordination stays outside session directories so inactive Notes
 * never needs to write beside a read-only saved session. No global process scan.
 * @param {string} file
 */
function cleanupKey(file) {
	let canonical;
	try {
		canonical = realpathSync(file);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
		canonical = resolve(file);
	}
	return createHash("sha256").update(canonical).digest("hex");
}

/** @param {string} file @param {string} storageDirectory */
export function cleanupStatus(file, storageDirectory) {
	return resolve(
		storageDirectory,
		"session-cleanup",
		`${cleanupKey(file)}.json`,
	);
}

/** @param {string} file */
export function cleanupPaths(file) {
	// Automatic cleanup is Linux-only. A fixed OS location, not TMPDIR, keeps
	// two local Pi launch environments in the same admission domain.
	const directory = join(
		"/tmp",
		`pi-notes-cleanup-${process.getuid?.() ?? "user"}`,
		cleanupKey(file),
	);
	try {
		privateRoot(dirname(directory));
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	return {
		directory,
		owners: join(directory, "owners"),
		lock: join(directory, "lock"),
	};
}

/** @param {string} file */
function ensureCleanupState(file) {
	const paths = cleanupPaths(file);
	const root = dirname(paths.directory);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	privateRoot(root);
	mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
	return paths;
}

/** Shared by startup admission and the after-exit writer.
 * @param {string} file @returns {(()=>void)|undefined}
 */
export function tryCleanupLock(file) {
	const paths = ensureCleanupState(file);
	try {
		const fd = openSync(paths.lock, "wx", 0o600);
		closeSync(fd);
		return () => {
			unlinkSync(paths.lock);
		};
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST")
			return;
		throw error;
	}
}

/** Pi accepts large headers. Read exactly the first complete source record,
 * accumulating pieces once instead of imposing a smaller extension-only limit.
 * @param {string} file @returns {unknown}
 */
export function cleanupHeader(file) {
	const fd = openSync(file, "r");
	/** @type {Buffer[]} */
	const pieces = [];
	let position = 0;
	try {
		while (true) {
			const buffer = Buffer.alloc(8192);
			const read = readSync(fd, buffer, 0, buffer.length, position);
			if (!read) throw new Error("The saved session header is incomplete.");
			position += read;
			const end = buffer.subarray(0, read).indexOf(10);
			pieces.push(buffer.subarray(0, end < 0 ? read : end));
			if (end >= 0) return JSON.parse(Buffer.concat(pieces).toString("utf8"));
		}
	} finally {
		closeSync(fd);
	}
}
