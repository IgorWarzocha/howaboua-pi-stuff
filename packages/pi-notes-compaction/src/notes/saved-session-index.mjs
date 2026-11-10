import { readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Exact path hints only. Neither the index nor a filename establishes Notes membership.
 * Missing indexes are normal for old sessions; other index failures are reported.
 * @param {string} threadId
 * @param {string} [agentDir]
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
export async function findSavedNotesSessions(threadId, agentDir, signal) {
	signal?.throwIfAborted();
	if (
		!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(threadId) ||
		threadId === "root"
	)
		throw new Error("Invalid saved session thread ID");
	const configured =
		agentDir ??
		process.env["PI_CODING_AGENT_DIR"] ??
		join(homedir(), ".pi", "agent");
	const dir =
		configured === "~" || configured.startsWith("~/")
			? join(homedir(), configured.slice(2))
			: resolve(configured);
	const paths = new Set();
	const index = join(dir, "notes-compaction", "notes.sqlite");
	try {
		await stat(index);
		/** @type {import("node:sqlite").DatabaseSync} */
		const db = process.versions["bun"]
			? new (createRequire(import.meta.url)("bun:sqlite").Database)(index, {
					readonly: true,
				})
			: new (await import("node:sqlite")).DatabaseSync(index, {
					readOnly: true,
				});
		try {
			signal?.throwIfAborted();
			const table = db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
				)
				.get();
			if (table) {
				const row = db
					.prepare("SELECT file_path FROM sessions WHERE id = ?")
					.get(threadId);
				if (row && typeof row["file_path"] === "string" && row["file_path"])
					paths.add(row["file_path"]);
			}
		} finally {
			db.close();
		}
	} catch (error) {
		signal?.throwIfAborted();
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw new Error(
				"Saved session index is unavailable. Restore access to the Notes index and retry.",
				{ cause: error },
			);
	}
	const sessions = join(dir, "sessions");
	try {
		for (const cwd of await readdir(sessions, { withFileTypes: true })) {
			signal?.throwIfAborted();
			if (!cwd.isDirectory()) continue;
			const directory = join(sessions, cwd.name);
			for (const file of await readdir(directory, { withFileTypes: true })) {
				signal?.throwIfAborted();
				if (file.isFile() && file.name.endsWith(`_${threadId}.jsonl`))
					paths.add(join(directory, file.name));
			}
		}
	} catch (error) {
		signal?.throwIfAborted();
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	return [...paths].sort();
}
