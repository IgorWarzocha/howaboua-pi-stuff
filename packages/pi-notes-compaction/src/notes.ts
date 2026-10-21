import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { NoteSnapshotData } from "./bridge.js";
import { type NoteRevision, NotesStore, type SessionRef } from "./store.js";

export const NOTE_RECEIPT = "notes-compaction:note:v1";
export const CACHE_RECEIPT = "notes-compaction:cache:v1";
export interface NoteReceipt {
	protocol: 1;
	sessionId: string;
	windowId: string;
	runId: string;
	origin?: "routed";
	/** Model-invisible recovery snapshot follows native fork and branch projections. */
	revision: NoteRevision;
}

export function sessionRef(ctx: ExtensionContext): SessionRef {
	return {
		id: ctx.sessionManager.getSessionId(),
		file: ctx.sessionManager.getSessionFile(),
	};
}

export function sourceSessionIds(ctx: ExtensionContext): string[] {
	const ids = new Set([ctx.sessionManager.getSessionId()]);
	for (const entry of ctx.sessionManager.getBranch())
		if (
			entry.type === "custom" &&
			entry.customType === CACHE_RECEIPT &&
			entry.data &&
			typeof entry.data === "object" &&
			"protocol" in entry.data &&
			entry.data.protocol === 1 &&
			"sessionId" in entry.data &&
			typeof entry.data.sessionId === "string"
		)
			ids.add(entry.data.sessionId);
	return [...ids];
}

export function noteReceipt(data: unknown): NoteReceipt | undefined {
	if (
		!data ||
		typeof data !== "object" ||
		!("protocol" in data) ||
		data.protocol !== 1 ||
		!("revision" in data)
	)
		return;
	const record = data as Partial<NoteReceipt>;
	const revision = record.revision;
	if (
		typeof record.sessionId !== "string" ||
		typeof record.windowId !== "string" ||
		typeof record.runId !== "string" ||
		(record.origin !== undefined && record.origin !== "routed") ||
		!revision ||
		typeof revision.id !== "string" ||
		typeof revision.path !== "string" ||
		typeof revision.text !== "string" ||
		!["replace", "append"].includes(revision.mode) ||
		!Number.isFinite(revision.createdAt) ||
		!Number.isFinite(revision.updatedAt)
	)
		return;
	return record as NoteReceipt;
}

function relativeLegacyPath(path: string): string {
	// Legacy canonical paths use the first notes component as the agent-root boundary.
	const components = path.split("/");
	const boundary = components.indexOf("notes");
	return components[0] === "" && components[1] === "root" && boundary > 1
		? components.slice(boundary + 1).join("/")
		: path;
}

function snapshotNotes(data: unknown, id: string): NoteRevision[] | undefined {
	if (
		!data ||
		typeof data !== "object" ||
		!("protocol" in data) ||
		data.protocol !== 1 ||
		!("files" in data) ||
		!Array.isArray(data.files)
	)
		return;
	const result: NoteRevision[] = [];
	for (const file of data.files) {
		if (
			!file ||
			typeof file !== "object" ||
			typeof file.path !== "string" ||
			typeof file.text !== "string" ||
			!Number.isFinite(file.createdAt) ||
			!Number.isFinite(file.updatedAt)
		)
			return;
		result.push({
			id,
			path: relativeLegacyPath(file.path),
			text: file.text,
			mode: file.operation === "local_append_overlay" ? "append" : "replace",
			createdAt: file.createdAt,
			updatedAt: file.updatedAt,
		});
	}
	return result;
}

/** Only selected-branch receipts choose visible revisions. Sibling writes never leak. */
export function collectNotes(
	store: Pick<NotesStore, "read">,
	entries: readonly SessionEntry[],
): Map<string, NoteRevision> {
	const notes = new Map<string, NoteRevision>();
	for (const entry of entries) {
		if (
			entry.type === "branch_summary" &&
			entry.details &&
			typeof entry.details === "object" &&
			"codexContextNoteHandoff" in entry.details
		) {
			for (const note of snapshotNotes(
				entry.details.codexContextNoteHandoff,
				entry.id,
			) ?? [])
				notes.set(note.path, note);
			continue;
		}
		if (entry.type !== "custom") continue;
		if (entry.customType === NOTE_RECEIPT) {
			const receipt = noteReceipt(entry.data);
			if (!receipt)
				throw new Error(
					"A saved note receipt is invalid. Open an intact session branch to recover notes.",
				);
			// A fork carries the receipt even when its source session was explicitly pruned.
			const revision = store.read(receipt.revision.id) ?? receipt.revision;
			notes.set(revision.path, revision);
		} else if (entry.customType === "codex-context-note") {
			const data = entry.data as
				| {
						protocol?: unknown;
						path?: unknown;
						text?: unknown;
						action?: unknown;
						timestamp?: unknown;
				  }
				| undefined;
			if (
				data?.protocol !== 1 ||
				typeof data.path !== "string" ||
				typeof data.text !== "string" ||
				(data.action !== "write" && data.action !== "append")
			)
				continue;
			const path = relativeLegacyPath(data.path);
			const previous = notes.get(path);
			const time = typeof data.timestamp === "number" ? data.timestamp : 0;
			notes.set(path, {
				id: entry.id,
				path,
				text:
					data.action === "append"
						? (previous?.text ?? "") + data.text
						: data.text,
				mode: "replace",
				createdAt: previous?.createdAt ?? time,
				updatedAt: time,
			});
		} else if (entry.customType === "codex-context-note-snapshot") {
			const snapshot = snapshotNotes(entry.data, entry.id);
			if (!snapshot) continue;
			notes.clear();
			for (const note of snapshot) notes.set(note.path, note);
		}
	}
	return notes;
}

/** Receipts carry recovery text, so detached reads need neither a database nor another process. */
export function exportNotesSnapshot(
	entries: readonly SessionEntry[],
	agentName: string,
): NoteSnapshotData {
	if (!/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(agentName))
		throw new Error("Invalid notes agent identity");
	const notes = collectNotes({ read: () => undefined }, entries);
	const snapshot: NoteSnapshotData = {
		protocol: 1,
		timestamp: Date.now(),
		files: [...notes.values()]
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((note) => ({
				path: `${agentName}/notes/${canonicalPath(note.path, agentName)}`,
				text: note.text,
				createdAt: note.createdAt,
				updatedAt: note.updatedAt,
				operation:
					note.mode === "append" ? "local_append_overlay" : "local_replacement",
			})),
	};
	if (
		snapshot.files.some((file) => Buffer.byteLength(file.text) > 1_000_000) ||
		Buffer.byteLength(JSON.stringify(snapshot)) > 10_000_000
	)
		throw new Error(
			"Notes snapshot exceeds the retained checkpoint size limit",
		);
	return snapshot;
}

function canonicalPath(path: unknown, agent: string, required = true): string {
	if (path === undefined || path === null || path === "") {
		if (required) throw new Error("Note file path is required");
		return "";
	}
	if (typeof path !== "string")
		throw new Error(
			required ? "Note file path is required" : "Note prefix must be a string",
		);
	const root = `${agent}/notes`;
	let value = path;
	if (value === root) {
		if (required)
			throw new Error("Absolute note paths must use <agent>/notes/<path>");
		value = "";
	} else if (value.startsWith(`${root}/`)) value = value.slice(root.length + 1);
	else if (value.startsWith("/"))
		throw new Error(
			"That agent's notes are not available here. Use a relative path for this agent.",
		);
	if (
		(required && !value) ||
		(value !== "" &&
			value.split("/").some((part) => !part || part === ".." || part === "."))
	)
		throw new Error(
			required
				? "Note paths cannot contain empty, . or .. components"
				: "Note prefixes cannot contain empty, . or .. components",
		);
	return value;
}

export function normalizeNoteParams(
	params: Record<string, unknown>,
	agent: string,
): Record<string, unknown> {
	const result = { ...params };
	for (const field of ["path", "prefix", "path_prefix"])
		if (field in params)
			result[field] = canonicalPath(params[field], agent, field === "path");
	return result;
}

export function noteHints(
	store: NotesStore,
	ctx: ExtensionContext,
	agent: string,
): string {
	const notes = [
		...collectNotes(store, ctx.sessionManager.getBranch()).values(),
	]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map((note) => `${agent}/notes/${note.path}`);
	const paths = [
		...new Set([...notes, ...store.cachedPaths(sourceSessionIds(ctx))]),
	].slice(0, 5);
	return paths.length ? `Recent notes: ${paths.join(", ")}`.slice(0, 4000) : "";
}

export function useNotes(
	pi: ExtensionAPI,
	store: NotesStore,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	agent: string,
	windowId: string,
	runId: string,
	routed = false,
): Record<string, unknown> {
	const notes = collectNotes(store, ctx.sessionManager.getBranch());
	const action = params["action"];
	const root = `${agent}/notes/`;
	if (action === "write_file" || action === "append_to_file") {
		const path = params["path"] as string;
		const text = params["text"];
		if (typeof text !== "string")
			throw new Error(`notes ${action} requires text`);
		const previous = notes.get(path);
		const next =
			action === "append_to_file" ? (previous?.text ?? "") + text : text;
		if (Buffer.byteLength(next) > 1_000_000)
			throw new Error("Note file exceeds the 1,000,000-byte limit");
		const now = Date.now();
		// Append never pretends to decode a remote base. The remote fragment remains separate.
		const mode =
			action === "write_file" ? "replace" : (previous?.mode ?? "append");
		let revision: NoteRevision;
		try {
			revision = store.write(sessionRef(ctx), {
				path,
				text: next,
				mode,
				createdAt: previous?.createdAt ?? now,
				updatedAt: now,
			});
		} catch {
			throw new Error(
				"Local note could not be saved. The selected branch remains unchanged. Retry after local storage is available.",
			);
		}
		try {
			pi.appendEntry(NOTE_RECEIPT, {
				protocol: 1,
				sessionId: ctx.sessionManager.getSessionId(),
				windowId,
				runId,
				...(routed ? { origin: "routed" as const } : {}),
				revision,
			} satisfies NoteReceipt);
		} catch {
			throw new Error(
				`Note ${root}${path} was stored but not attached to this session. Read it before retrying the write.`,
			);
		}
		return {
			file: { path: `${root}${path}` },
		};
	}
	return readNotes(notes, params, agent);
}

export function readNotes(
	notes: ReadonlyMap<string, NoteRevision>,
	params: Record<string, unknown>,
	agent: string,
): Record<string, unknown> {
	const action = params["action"];
	const root = `${agent}/notes/`;
	if (action === "read_file") {
		const path = params["path"] as string;
		const note = notes.get(path);
		if (!note) return { source: "pi-session", file: null };
		const lines = note.text.split("\n");
		const start = lineIndex(params["start_line"], lines.length, 0);
		const stop = lineIndex(params["stop_line"], lines.length, lines.length - 1);
		return {
			source: "pi-session",
			file: {
				...noteMetadata(note, root),
				content: start <= stop ? lines.slice(start, stop + 1).join("\n") : "",
				start_line: start + 1,
				stop_line: Math.max(start, stop) + 1,
				total_lines: lines.length,
			},
		};
	}
	if (action === "list_files_by_prefix") {
		const by = params["file_order_by"];
		const direction = params["file_order"] === "descending" ? -1 : 1;
		const files = [...notes.values()]
			.filter((note) => note.path.startsWith(String(params["prefix"] ?? "")))
			.sort(
				(a, b) =>
					(by === "created_at"
						? a.createdAt - b.createdAt
						: by === "updated_at"
							? a.updatedAt - b.updatedAt
							: a.path.localeCompare(b.path)) * direction,
			)
			.slice(0, integer(params["max_results"], 20, 100))
			.map((note) => noteMetadata(note, root));
		return { source: "pi-session", files };
	}
	if (action !== "search_contents")
		throw new Error("notes requires a supported action");
	const query = params["query"];
	if (typeof query !== "string" || !query)
		throw new Error("notes search_contents requires query");
	const files = [...notes.values()].filter((note) =>
		note.path.startsWith(String(params["path_prefix"] ?? "")),
	);
	files.sort(
		params["recent_file_first"] === true
			? (a, b) => b.createdAt - a.createdAt
			: (a, b) => a.path.localeCompare(b.path),
	);
	const found: Record<string, unknown>[] = [];
	for (const note of files) {
		const matches = note.text
			.split("\n")
			.map((line, index) => ({ line_number: index + 1, line }))
			.filter(({ line }) => line.includes(query))
			.slice(0, integer(params["max_matches_per_file"], 20, 100));
		if (!matches.length) continue;
		found.push({
			path: `${root}${note.path}`,
			matches,
			operation:
				note.mode === "replace" ? "local_replacement" : "local_append_overlay",
		});
		if (found.length >= integer(params["max_files"], 20, 100)) break;
	}
	return { source: "pi-session", files: found };
}

function noteMetadata(
	note: NoteRevision,
	root: string,
): Record<string, unknown> {
	return {
		operation:
			note.mode === "replace" ? "local_replacement" : "local_append_overlay",
		path: `${root}${note.path}`,
		bytes: Buffer.byteLength(note.text, "utf8"),
		created_at: new Date(note.createdAt).toISOString(),
		updated_at: new Date(note.updatedAt).toISOString(),
	};
}

function lineIndex(
	value: unknown,
	lineCount: number,
	fallback: number,
): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value === 0)
		return fallback;
	const index = value > 0 ? value - 1 : lineCount + value;
	return Math.max(0, Math.min(index, Math.max(0, lineCount - 1)));
}

function integer(value: unknown, fallback: number, max: number): number {
	return typeof value === "number" && Number.isInteger(value)
		? Math.max(1, Math.min(value, max))
		: fallback;
}
