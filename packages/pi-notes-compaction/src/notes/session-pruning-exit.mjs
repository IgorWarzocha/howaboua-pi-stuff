import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { cleanSparseSession } from "./session-pruning-cleanup.mjs";
import {
	cleanupHeader,
	cleanupPaths,
	tryCleanupLock,
} from "./session-pruning-state.mjs";

/** @typedef {{pid:number; host:string; start:string; sessionId:string}} Owner */
const host = hostname();

/** Linux start time prevents a recycled PID from impersonating an owner.
 * @param {number} pid
 */
function processStart(pid) {
	const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? "";
}

/** @param {Owner} owner */
function alive(owner) {
	if (owner.host !== host) return true;
	try {
		return processStart(owner.pid) === owner.start;
	} catch (error) {
		if (missing(error)) return false;
		throw error;
	}
}

/** @param {unknown} error */
function missing(error) {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ESRCH")
	);
}

/** @param {unknown} value @returns {value is Owner} */
function isOwner(value) {
	if (!value || typeof value !== "object") return false;
	const data = /** @type {Record<string,unknown>} */ (value);
	return (
		Number.isSafeInteger(data["pid"]) &&
		Number(data["pid"]) > 0 &&
		typeof data["host"] === "string" &&
		typeof data["start"] === "string" &&
		data["start"].length > 0 &&
		typeof data["sessionId"] === "string"
	);
}

/** Keep a positive claim while a saved session has a live Notes runtime.
 * @param {string|undefined} file @param {string} sessionId
 * @returns {(()=>void)|undefined}
 */
function registerCleanupOwner(file, sessionId) {
	if (process.platform !== "linux" || !file || !existsSync(file)) return;
	const owner = {
		pid: process.pid,
		host,
		start: processStart(process.pid),
		sessionId,
	};
	const directory = cleanupPaths(file).owners;
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const entry = join(
		directory,
		`${encodeURIComponent(host)}-${owner.pid}-${owner.start}-${randomUUID()}.json`,
	);
	writeFileSync(entry, JSON.stringify(owner), { mode: 0o600 });
	const release = () => {
		try {
			unlinkSync(entry);
		} catch (error) {
			if (!missing(error)) throw error;
		}
		try {
			rmdirSync(directory);
		} catch (error) {
			if (
				!missing(error) &&
				!(
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOTEMPTY"
				)
			)
				throw error;
		}
	};
	const onExit = () => {
		// A failed best-effort release remains a stale claim; the worker removes
		// it only after proving this PID/start identity has ended.
		try {
			release();
		} catch {
			/* Never turn normal Pi exit into a cleanup failure. */
		}
	};
	process.once("exit", onExit);
	return () => {
		process.off("exit", onExit);
		release();
	};
}

/** @param {unknown} header @param {string} sessionId */
function generation(header, sessionId) {
	if (
		!header ||
		typeof header !== "object" ||
		!("id" in header) ||
		header.id !== sessionId
	)
		throw new Error("Session identity changed during startup.");
	if (!("notesPruning" in header) || header.notesPruning === undefined) return;
	const marker = header.notesPruning;
	if (
		!marker ||
		typeof marker !== "object" ||
		!("generation" in marker) ||
		typeof marker.generation !== "string"
	)
		throw new Error("Session pruning generation could not be validated.");
	return marker.generation;
}

/** The manager is loaded before extension hooks. Serialize claim establishment
 * with cleanup, then detect a rewrite that won before this startup could claim.
 * @param {string|undefined} file @param {string} sessionId @param {unknown} loadedHeader
 */
export async function admitSessionCleanup(file, sessionId, loadedHeader) {
	if (process.platform !== "linux" || !file || !existsSync(file)) return;
	const deadline = Date.now() + 120_000;
	let unlock = tryCleanupLock(file);
	while (!unlock) {
		if (Date.now() >= deadline)
			throw new Error(
				`Session cleanup did not release ${JSON.stringify(cleanupPaths(file).lock)}. Verify no cleanup is active before removing a stale lock, then restart Pi.`,
			);
		await setTimeout(25);
		unlock = tryCleanupLock(file);
	}
	try {
		const raw = cleanupHeader(file);
		const release = registerCleanupOwner(file, sessionId);
		return {
			release,
			stale: generation(raw, sessionId) !== generation(loadedHeader, sessionId),
		};
	} finally {
		unlock();
	}
}

/** Do not delete records from another live manager of this exact saved session.
 * Unknown/foreign claims are intentionally conservative. Unregistered foreign
 * JSONL writers are outside the extension's ownership, as with live pruning.
 * @param {string} file
 */
function checkOwners(file) {
	const directory = cleanupPaths(file).owners;
	let entries;
	try {
		entries = readdirSync(directory);
	} catch (error) {
		if (missing(error)) return;
		throw error;
	}
	for (const name of entries) {
		const path = join(directory, name);
		let owner;
		try {
			owner = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			if (missing(error)) continue;
			throw error;
		}
		if (!isOwner(owner))
			throw new Error(
				"Session cleanup found an unrecognised live-session claim. Retired payloads remain pruned.",
			);
		if (alive(owner))
			throw new Error(
				"Session record cleanup was skipped because another process still owns this session. It will retry when that session exits.",
			);
		try {
			unlinkSync(path);
		} catch (error) {
			if (!missing(error)) throw error;
		}
	}
}

/** @param {string} path @param {string} sessionId */
export function previousCleanupFailure(path, sessionId) {
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		unlinkSync(path);
		return value.sessionId === sessionId && typeof value.error === "string"
			? value.error
			: undefined;
	} catch (error) {
		if (missing(error)) return;
		throw error;
	}
}

/** @param {string} path @param {string} sessionId @param {unknown} error */
export function recordCleanupFailure(path, sessionId, error) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(
		temp,
		JSON.stringify({
			sessionId,
			timestamp: new Date().toISOString().slice(0, 16) + "Z",
			error: error instanceof Error ? error.message : String(error),
		}),
		{ mode: 0o600 },
	);
	renameSync(temp, path);
}

/** Schedule without holding Pi open; this worker does not touch the graph until
 * the real owning process exits, not merely when shutdown hooks finish.
 * @param {string} file @param {string} sessionId @param {string} statusPath
 */
export async function scheduleSessionCleanup(file, sessionId, statusPath) {
	if (!existsSync(file)) return;
	if (process.platform !== "linux")
		throw new Error(
			"Automatic session record cleanup is unavailable on this platform. Retired payloads remain pruned.",
		);
	const owner = {
		pid: process.pid,
		host,
		start: processStart(process.pid),
		sessionId,
	};
	const child = spawn(
		"node",
		[fileURLToPath(import.meta.url), file, JSON.stringify(owner), statusPath],
		{
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		},
	);
	await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("spawn", resolve);
	});
	child.unref();
}

/** @param {string} file @param {Owner} owner @param {string} statusPath */
async function afterExit(file, owner, statusPath) {
	try {
		const deadline = Date.now() + 120_000;
		while (alive(owner)) {
			if (Date.now() >= deadline)
				throw new Error(
					"Session record cleanup was skipped because Pi did not exit. It will retry on the next normal exit.",
				);
			await setTimeout(250);
		}
		await cleanSparseSession(file, owner.sessionId, () => checkOwners(file));
		try {
			unlinkSync(statusPath);
		} catch (error) {
			if (!missing(error)) throw error;
		}
	} catch (error) {
		recordCleanupFailure(statusPath, owner.sessionId, error);
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [file, encoded, statusPath] = process.argv.slice(2);
	const owner = encoded && JSON.parse(encoded);
	if (
		!file ||
		!statusPath ||
		!isAbsolute(statusPath) ||
		!isOwner(owner) ||
		owner.host !== host ||
		process.platform !== "linux"
	)
		throw new Error("Invalid after-exit session cleanup request.");
	await afterExit(file, owner, statusPath);
}
