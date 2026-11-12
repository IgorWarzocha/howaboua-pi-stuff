import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type Database from "better-sqlite3";
import { entryKey, object } from "./normalise.ts";

const CHUNK_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 32 * 1024 * 1024;

interface IndexedSource {
	id: number;
	path: string;
	identity: string;
	offset: number;
	line: number;
	session_id: string;
}

interface Range {
	line: number;
	start: number;
	length: number;
	digest: string;
	entry_id: string | null;
	entry_key: string | null;
	physicalLine?: number | null;
}

function generation(header: unknown): string | undefined {
	const record = object(header);
	const marker = object(record["notesPruning"]);
	return record["type"] === "session" &&
		typeof record["id"] === "string" &&
		marker["version"] === 1 &&
		marker["sessionId"] === record["id"] &&
		typeof marker["generation"] === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			marker["generation"],
		)
		? marker["generation"]
		: undefined;
}

/** Logical source lines survive sparse rewrites; recipes cannot address changed payloads. */
export function createSourcePruning(db: Database.Database) {
	const key = (id: number) => `sessionPruneGeneration:${id}`;
	const getGeneration = db.prepare<[string], { value: string }>(
		"SELECT value FROM metadata WHERE key=?",
	);
	const putGeneration = db.prepare(
		"INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	);
	const getRanges = db.prepare<[number], Range>(`
		SELECT r.line,r.start,r.length,r.digest,e.entry_id,e.entry_key FROM source_records r
		LEFT JOIN file_entries e ON e.file_id=r.file_id AND e.line=r.line
		WHERE r.file_id=? ORDER BY r.line
	`);
	const updateRange = db.prepare(
		"UPDATE source_records SET start=?,length=?,digest=? WHERE file_id=? AND line=?",
	);
	const updateFile = db.prepare(
		"UPDATE files SET identity=?,offset=?,tail=X'',skipping=0,mtime=? WHERE id=?",
	);
	const putPosition = db.prepare(`INSERT INTO source_positions VALUES (?,?,?)
		ON CONFLICT(file_id,line) DO UPDATE SET physical_line=excluded.physical_line`);
	const putDelta = db.prepare(`INSERT INTO source_position_files VALUES (?,?)
		ON CONFLICT(file_id) DO UPDATE SET delta=excluded.delta`);
	const revision = db.prepare(
		"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
	);

	function rememberHeader(id: number, header: unknown): void {
		putGeneration.run(key(id), generation(header) ?? "");
	}

	async function reconcile(
		file: IndexedSource,
		candidate: { identity: string; size: number; mtime: number },
		keepGoing: () => boolean,
		readBytes: (count: number) => void,
	): Promise<"rebased" | "unsupported" | "retry"> {
		const handle = await open(file.path, "r");
		try {
			const initial = await handle.stat();
			if (
				`${initial.dev}:${initial.ino}` !== candidate.identity ||
				initial.size < candidate.size
			)
				return "retry";
			const headerBuffer = Buffer.allocUnsafe(
				Math.min(64 * 1024, candidate.size),
			);
			const head = await handle.read(headerBuffer, 0, headerBuffer.length, 0);
			readBytes(head.bytesRead);
			const headerEnd = headerBuffer.subarray(0, head.bytesRead).indexOf(10);
			if (headerEnd < 0) return "unsupported";
			let header: unknown;
			try {
				header = JSON.parse(
					headerBuffer.subarray(0, headerEnd).toString("utf8"),
				);
			} catch (error) {
				if (error instanceof SyntaxError) return "unsupported";
				throw error;
			}
			const nextGeneration = generation(header);
			if (
				!nextGeneration ||
				object(header)["id"] !== file.session_id ||
				nextGeneration === getGeneration.get(key(file.id))?.value
			)
				return "unsupported";

			// Source lines are stable logical handles, not physical line numbers. New
			// entries receive handles after file.line, even after physical deletions.
			const ranges = getRanges.all(file.id);
			const byId = new Map<string, Range>();
			for (const range of ranges) {
				if (range.line === 1) continue;
				if (!range.entry_id || byId.has(range.entry_id)) return "unsupported";
				byId.set(range.entry_id, range);
			}
			const headerRange = ranges.find((range) => range.line === 1);
			if (!headerRange) return "unsupported";
			const seen = new Set<string>();
			let previousLine = 0;
			let physicalLine = 0;
			let offset = 0;
			let start = 0;
			let length = 0;
			let boundary: number | undefined;
			let boundaryLine: number | undefined;
			let pieces: Buffer[] = [];
			while (offset < candidate.size) {
				if (!keepGoing()) return "retry";
				const buffer = Buffer.allocUnsafe(
					Math.min(CHUNK_BYTES, candidate.size - offset),
				);
				const read = await handle.read(buffer, 0, buffer.length, offset);
				if (!read.bytesRead) return "retry";
				readBytes(read.bytesRead);
				const chunk = buffer.subarray(0, read.bytesRead);
				let cursor = 0;
				while (cursor < chunk.length) {
					const newline = chunk.indexOf(10, cursor);
					const end = newline < 0 ? chunk.length : newline;
					length += end - cursor;
					if (length > MAX_LINE_BYTES) return "unsupported";
					pieces.push(chunk.subarray(cursor, end));
					cursor = end + (newline < 0 ? 0 : 1);
					if (newline < 0) continue;
					physicalLine++;
					const raw =
						pieces.length === 1 ? pieces[0]! : Buffer.concat(pieces, length);
					let record: unknown;
					try {
						record = JSON.parse(raw.toString("utf8"));
					} catch (error) {
						if (error instanceof SyntaxError) return "unsupported";
						throw error;
					}
					const id = object(record)["id"];
					if (typeof id !== "string") return "unsupported";
					const range = physicalLine === 1 ? headerRange : byId.get(id);
					if (physicalLine === 1 && generation(record) !== nextGeneration)
						return "retry";
					if (!range) {
						if (boundary === undefined) {
							boundary = start;
							boundaryLine = physicalLine - 1;
						}
					} else {
						if (
							boundary !== undefined ||
							range.line <= previousLine ||
							seen.has(id)
						)
							return "unsupported";
						seen.add(id);
						previousLine = range.line;
						range.physicalLine = physicalLine;
						const digest = createHash("sha256").update(raw).digest("hex");
						if (physicalLine === 1) {
							range.digest = digest;
							range.length = length;
						} else if (
							range.length > 0 &&
							(digest === range.digest ||
								(range.entry_key !== null &&
									entryKey(object(record)) === range.entry_key))
						) {
							range.length = length;
							range.digest = digest;
						} else range.length = 0;
						range.start = start;
					}
					start = offset + cursor;
					pieces = [];
					length = 0;
				}
				offset += read.bytesRead;
			}
			if (!physicalLine) return "unsupported";
			for (const range of ranges)
				if (range.line !== 1 && range.entry_id && !seen.has(range.entry_id))
					range.length = 0;
			const [current, path] = await Promise.all([
				handle.stat(),
				stat(file.path),
			]);
			if (
				!keepGoing() ||
				`${path.dev}:${path.ino}` !== candidate.identity ||
				`${current.dev}:${current.ino}` !== candidate.identity ||
				current.size < initial.size ||
				(current.size === initial.size && current.mtimeMs !== initial.mtimeMs)
			)
				return "retry";
			db.transaction(() => {
				for (const range of ranges) {
					updateRange.run(
						range.start,
						range.length,
						range.digest,
						file.id,
						range.line,
					);
					putPosition.run(file.id, range.line, range.physicalLine ?? null);
				}
				putDelta.run(file.id, (boundaryLine ?? physicalLine) - file.line);
				updateFile.run(
					candidate.identity,
					boundary ?? start,
					current.mtimeMs,
					file.id,
				);
				putGeneration.run(key(file.id), nextGeneration);
				revision.run();
			})();
			return "rebased";
		} finally {
			await handle.close();
		}
	}

	return { rememberHeader, reconcile };
}
