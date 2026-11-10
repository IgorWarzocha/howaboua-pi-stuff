import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const packages = ["@howaboua/pi-agent-comms", "@howaboua/pi-notes-compaction"];
export const NOTES_READER_UNAVAILABLE =
	"Saved Notes reads are unavailable. Install Agent Comms or Notes Compaction alongside Shepherdr, then reload Pi. Other agent operations remain available.";
const INVALID_READER =
	"Saved Notes could not be loaded. Update their extension and reload Pi. Other agent operations remain available.";

/** Public Node-only readers have no event API. Resolve only on their optional boundary.
 * @param {"saved-session" | "saved-session-index"} name
 * @returns {URL | undefined}
 */
export function notesModule(name) {
	const require = createRequire(import.meta.url);
	for (const packageName of packages) {
		const specifier = `${packageName}/${name}`;
		try {
			return pathToFileURL(require.resolve(specifier));
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				!(
					error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
					(error.code === "MODULE_NOT_FOUND" &&
						error.message.startsWith(`Cannot find module '${specifier}'`))
				)
			)
				throw new Error(INVALID_READER, { cause: error });
		}
	}
	return undefined;
}

/** @param {URL} url */
async function loadReader(url) {
	try {
		return await import(url.href);
	} catch (error) {
		throw new Error(INVALID_READER, { cause: error });
	}
}

/** @param {string} path @param {AbortSignal} [signal] @param {boolean} [history]
 * @returns {ReturnType<typeof import("@howaboua/pi-agent-comms/saved-session").readSavedNotesSession>}
 */
export async function readSavedNotesSession(path, signal, history = false) {
	signal?.throwIfAborted();
	const url = notesModule("saved-session");
	if (!url) throw new Error(NOTES_READER_UNAVAILABLE);
	const reader = await loadReader(url);
	if (typeof reader.readSavedNotesSession !== "function")
		throw new Error(INVALID_READER);
	return reader.readSavedNotesSession(path, signal, history);
}

/** @param {string} threadId @param {AbortSignal} [signal] @returns {Promise<string[]>} */
export async function findSavedNotesSessions(threadId, signal) {
	signal?.throwIfAborted();
	const url = notesModule("saved-session-index");
	if (!url) throw new Error(NOTES_READER_UNAVAILABLE);
	const index = await loadReader(url);
	if (typeof index.findSavedNotesSessions !== "function")
		throw new Error(INVALID_READER);
	return index.findSavedNotesSessions(threadId, undefined, signal);
}
