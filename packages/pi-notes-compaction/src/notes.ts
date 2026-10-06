import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { type NoteRevision, NotesStore, type SessionRef } from "./store.js";

export const NOTE_RECEIPT = "notes-compaction:note:v1";
export const CACHE_RECEIPT = "notes-compaction:cache:v1";
export interface NoteReceipt {
	protocol: 1;
	sessionId: string;
	windowId: string;
	runId: string;
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
	return path.replace(/^\/root(?:\/[a-zA-Z0-9_-]+)*\/notes\/?/, "");
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
			mode: "replace",
			createdAt: file.createdAt,
			updatedAt: file.updatedAt,
		});
	}
	return result;
}

/** Only selected-branch receipts choose visible revisions. Sibling writes never leak. */
export function collectNotes(
	store: NotesStore,
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

function canonicalPath(path: unknown, agent: string, required = true): string {
	if (typeof path !== "string" || !path.trim()) {
		if (required) throw new Error("Supply a note path");
		return "";
	}
	const root = `${agent}/notes`;
	let value = path;
	if (value === root) value = "";
	else if (value.startsWith(`${root}/`)) value = value.slice(root.length + 1);
	else if (value.startsWith("/"))
		throw new Error(
			"That agent's notes are not available here. Use a relative path for this agent.",
		);
	if (
		(required && !value) ||
		value.split("/").some((part) => part === ".." || part === ".") ||
		/[\0\r\n]/.test(value)
	)
		throw new Error(
			"Use a virtual note path without dot segments or control characters",
		);
	return value;
}

export function normalizeNoteParams(
	params: Record<string, unknown>,
	agent: string,
): Record<string, unknown> {
	const result = { ...params };
	const needsPath = ["read_file", "write_file", "append_to_file"].includes(
		String(params["action"]),
	);
	for (const field of ["path", "prefix", "path_prefix"])
		if (field in params || field !== "path" || needsPath)
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
): Record<string, unknown> {
	const notes = collectNotes(store, ctx.sessionManager.getBranch());
	const action = params["action"];
	const root = `${agent}/notes/`;
	if (action === "write_file" || action === "append_to_file") {
		const path = params["path"] as string;
		const text = params["text"];
		if (typeof text !== "string") throw new Error("Supply note text");
		const previous = notes.get(path);
		const next =
			action === "append_to_file" ? (previous?.text ?? "") + text : text;
		if (Buffer.byteLength(next) > 1_000_000)
			throw new Error("Note exceeds 1 MB. Split it into separate paths.");
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
				revision,
			} satisfies NoteReceipt);
		} catch {
			throw new Error(
				`Note ${root}${path} reached local storage but its session receipt failed. Reread the selected branch before retrying.`,
			);
		}
		return {
			path: `${root}${path}`,
			chars: next.length,
			operation:
				mode === "append" ? "local_append_overlay" : "local_replacement",
		};
	}
	if (action === "read_file") {
		const path = params["path"] as string;
		const note = notes.get(path);
		if (!note) return { path: `${root}${path}`, file: null };
		const lines = note.text.split("\n");
		const start = integer(params["start_line"], 1, lines.length + 1);
		const stop = integer(params["stop_line"], lines.length, lines.length);
		let text = "";
		let next = start;
		while (next <= stop) {
			const line = lines[next - 1] ?? "";
			if (text.length + line.length > 32_000) {
				if (!text)
					throw new Error(
						"This note line exceeds 32000 characters. Rewrite it as shorter lines to read it.",
					);
				break;
			}
			text += `${next > start ? "\n" : ""}${line}`;
			next++;
		}
		return {
			path: `${root}${path}`,
			text,
			start_line: start,
			total_lines: lines.length,
			...(next <= stop ? { next_start_line: next } : {}),
			operation:
				note.mode === "replace" ? "local_replacement" : "local_append_overlay",
		};
	}
	if (action === "list_files_by_prefix") {
		let files = [...notes.values()].filter((note) =>
			note.path.startsWith(String(params["prefix"] ?? "")),
		);
		const by = params["file_order_by"];
		files.sort((a, b) =>
			by === "created_at"
				? a.createdAt - b.createdAt
				: by === "updated_at"
					? a.updatedAt - b.updatedAt
					: a.path.localeCompare(b.path),
		);
		if (params["file_order"] === "descending") files.reverse();
		const maximum = integer(params["max_results"], 100, 100);
		return {
			files: files.slice(0, maximum).map((note) => ({
				path: `${root}${note.path}`,
				chars: note.text.length,
				updated_at: note.updatedAt,
			})),
			truncated: files.length > maximum,
		};
	}
	if (
		action !== "search_contents" ||
		typeof params["query"] !== "string" ||
		!params["query"]
	)
		throw new Error("Supply a nonempty search query");
	const files = [...notes.values()].filter((note) =>
		note.path.startsWith(String(params["path_prefix"] ?? "")),
	);
	if (params["recent_file_first"] === true)
		files.sort((a, b) => b.updatedAt - a.updatedAt);
	const found: {
		path: string;
		matches: { line: number; text: string }[];
		truncated: boolean;
	}[] = [];
	let chars = 0;
	let truncated = false;
	for (const note of files) {
		const all = note.text
			.split("\n")
			.flatMap((line, i) =>
				line.includes(params["query"] as string)
					? [{ line: i + 1, text: line.slice(0, 1000) }]
					: [],
			);
		if (!all.length) continue;
		const matches = all.slice(
			0,
			integer(params["max_matches_per_file"], 10, 100),
		);
		const size = JSON.stringify(matches).length;
		if (
			found.length >= integer(params["max_files"], 20, 100) ||
			chars + size > 32_000
		) {
			truncated = true;
			break;
		}
		found.push({
			path: `${root}${note.path}`,
			matches,
			truncated: matches.length < all.length,
		});
		chars += size;
	}
	return { files: found, truncated };
}

function integer(value: unknown, fallback: number, max: number): number {
	return typeof value === "number" && Number.isInteger(value)
		? Math.max(1, Math.min(value, max))
		: fallback;
}
