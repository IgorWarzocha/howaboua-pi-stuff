import type { NoteRevision } from "./store.js";

export function canonicalPath(
	path: unknown,
	agent: string,
	required = true,
): string {
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
		if (!note) return { file: null };
		const lines = note.text.split("\n");
		const start = lineIndex(params["start_line"], lines.length, 0);
		const stop = lineIndex(params["stop_line"], lines.length, lines.length - 1);
		return {
			file: {
				path: `${root}${note.path}`,
				content: start <= stop ? lines.slice(start, stop + 1).join("\n") : "",
				start_line: start + 1,
				stop_line: Math.max(start, stop) + 1,
				total_lines: lines.length,
				...(note.mode === "append" ? { append_only: true } : {}),
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
			.map((note) => ({
				path: `${root}${note.path}`,
				updated_at: new Date(note.updatedAt).toISOString(),
				...(by === "created_at"
					? { created_at: new Date(note.createdAt).toISOString() }
					: {}),
			}));
		const limit = integer(params["max_results"], 20, 100);
		return {
			files: files.slice(0, limit),
			...(files.length > limit ? { truncated: true } : {}),
		};
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
	const fileLimit = integer(params["max_files"], 20, 100);
	const matchLimit = integer(params["max_matches_per_file"], 20, 100);
	for (const note of files) {
		const matches = note.text
			.split("\n")
			.map((line, index) => ({ line_number: index + 1, line }))
			.filter(({ line }) => line.includes(query));
		if (!matches.length) continue;
		if (found.length === fileLimit) return { files: found, truncated: true };
		found.push({
			path: `${root}${note.path}`,
			matches: matches.slice(0, matchLimit),
			...(matches.length > matchLimit ? { truncated: true } : {}),
			...(note.mode === "append" ? { append_only: true } : {}),
		});
	}
	return { files: found };
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
