import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	openSync,
	readdirSync,
	readSync,
} from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CacheSnapshot } from "./contracts.ts";
import { blankCursor, type FileCursor } from "./index-store.ts";
import { label, parseLine } from "./parser.ts";
import { REBILL_VERSION, replayRebill } from "./rebill.ts";
import { applyEvent, newRecord, type RequestRecord } from "./requests.ts";

export type IngestionCoverage = Omit<
	CacheSnapshot["coverage"],
	| "fromDay"
	| "toDay"
	| "historyTruncated"
	| "requestsTruncated"
	| "legacyRecords"
>;

function anchor(fd: number, offset: number): string {
	const buffer = Buffer.alloc(Math.min(offset, 256));
	const count = readSync(fd, buffer, 0, buffer.length, offset - buffer.length);
	return createHash("sha256").update(buffer.subarray(0, count)).digest("hex");
}

function consume(
	db: DatabaseSync,
	name: string,
	cursor: FileCursor,
	line: Buffer,
	position: number,
	replay: boolean,
): void {
	const parsed = parseLine(line.toString("utf8").replace(/\r$/, ""));
	if (parsed.kind === "malformed") {
		cursor.malformed++;
		return;
	}
	if (parsed.kind === "ignore") return;
	if (parsed.kind === "header") {
		if (parsed.key === "opened")
			cursor.header = {
				epoch: cursor.header.epoch + 1,
				sessionId: null,
				sessionName: null,
				project: null,
			};
		if (parsed.key === "session_id")
			cursor.header.sessionId = parsed.value || null;
		if (parsed.key === "session_name")
			cursor.header.sessionName = parsed.value || null;
		if (parsed.key === "cwd") cursor.header.project = parsed.value || null;
		return;
	}
	const event = parsed.event;
	const localId = label(event, "local_request_id");
	const lane =
		label(event, "lane") ??
		(label(event, "event") === "prewarm-ready" ? "prewarm" : "Unknown");
	const identity = JSON.stringify([
		name,
		cursor.rewrites,
		cursor.header.epoch,
		cursor.header.sessionId,
		label(event, "scope"),
		lane,
		localId ?? position,
	]);
	const id = createHash("sha256")
		.update(identity)
		.digest("base64url")
		.slice(0, 24);
	const existing =
		localId || replay
			? db.prepare("SELECT data FROM records WHERE id=?").get(id)
			: undefined;
	const record: RequestRecord =
		existing && typeof existing["data"] === "string"
			? JSON.parse(existing["data"])
			: newRecord(id, event, cursor.header);
	if (replay) {
		if (!existing) return;
		replayRebill(record, event, cursor);
		db.prepare("UPDATE records SET data=? WHERE id=?").run(
			JSON.stringify(record),
			id,
		);
		return;
	}
	if (applyEvent(record, event)) cursor.invalidUsage++;
	db.prepare(
		"INSERT INTO records VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
	).run(
		id,
		name,
		record.row.time.slice(0, 10),
		record.row.time,
		JSON.stringify(record),
	);
}

/** Offset, partial UTF-8 bytes, header, correlated rows and counters share each chunk transaction. */
function ingestChunk(
	db: DatabaseSync,
	fd: number,
	name: string,
	cursor: FileCursor,
	bytes: number,
	replay = false,
): number {
	const buffer = Buffer.alloc(bytes);
	const count = readSync(fd, buffer, 0, bytes, cursor.offset);
	if (!count) return 0;
	const oldTail = Buffer.from(cursor.tail, "base64");
	const input = Buffer.concat([oldTail, buffer.subarray(0, count)]);
	const startOffset = cursor.offset - oldTail.length;
	db.exec("BEGIN IMMEDIATE");
	try {
		let start = 0;
		for (
			let end = input.indexOf(10);
			end !== -1;
			end = input.indexOf(10, start)
		) {
			if (cursor.discarding) cursor.discarding = false;
			else if (end - start > 65536) cursor.malformed++;
			else
				consume(
					db,
					name,
					cursor,
					input.subarray(start, end),
					startOffset + start,
					replay,
				);
			start = end + 1;
		}
		const tail = input.subarray(start);
		if (tail.length > 65536) {
			if (!cursor.discarding) cursor.malformed++;
			cursor.discarding = true;
		}
		cursor.tail = cursor.discarding ? "" : tail.toString("base64");
		cursor.offset += count;
		cursor.anchor = anchor(fd, cursor.offset);
		db.prepare(
			`UPDATE ${replay ? "rebill_files" : "files"} SET data=? WHERE name=?`,
		).run(JSON.stringify(cursor), name);
		db.exec(
			"UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
		);
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
	return count;
}

export function ingest(
	db: DatabaseSync,
	directory: string,
	options: { byteBudget?: number; timeBudgetMs?: number } = {},
): IngestionCoverage {
	const coverage: IngestionCoverage = {
		directory,
		directoryAvailable: true,
		files: 0,
		indexedFiles: 0,
		pendingBytes: 0,
		partialFiles: 0,
		malformed: 0,
		invalidUsage: 0,
		rewrittenFiles: 0,
		missingFiles: 0,
		unreadableFiles: 0,
		rebillPendingFiles: 0,
	};
	let names: string[];
	try {
		names = readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if (
			!(
				error instanceof Error &&
				"code" in error &&
				["ENOENT", "EACCES", "ENOTDIR"].includes(String(error.code))
			)
		)
			throw error;
		coverage.directoryAvailable = false;
		names = [];
	}
	coverage.files = names.length;
	const present = new Set(names);
	const known = new Map<string, FileCursor>();
	for (const row of db.prepare("SELECT name, data FROM files").iterate()) {
		if (typeof row["name"] === "string" && typeof row["data"] === "string")
			known.set(row["name"], JSON.parse(row["data"]));
	}
	let remaining = options.byteBudget ?? 24 * 1024 * 1024;
	const deadline = performance.now() + (options.timeBudgetMs ?? 8000);
	for (const name of names) {
		let fd: number | undefined;
		try {
			fd = openSync(
				join(directory, name),
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
		} catch {
			coverage.unreadableFiles++;
			continue;
		}
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile()) {
				coverage.unreadableFiles++;
				continue;
			}
			const identity = `${stat.dev}:${stat.ino}`;
			let cursor = known.get(name);
			if (
				cursor &&
				(cursor.identity !== identity ||
					stat.size < cursor.offset ||
					anchor(fd, cursor.offset) !== cursor.anchor)
			) {
				const fresh = blankCursor(identity, cursor.rewrites + 1);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.prepare("UPDATE files SET data=? WHERE name=?").run(
						JSON.stringify(fresh),
						name,
					);
					db.prepare("DELETE FROM rebill_files WHERE name=?").run(name);
					db.exec(
						"UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
					);
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
				cursor = fresh;
			}
			if (!cursor) {
				cursor = blankCursor(identity);
				cursor.anchor = anchor(fd, 0);
				db.prepare("INSERT INTO files VALUES (?, ?)").run(
					name,
					JSON.stringify(cursor),
				);
			}
			known.set(name, cursor);
			while (
				remaining > 0 &&
				performance.now() < deadline &&
				cursor.offset < stat.size
			) {
				const read = ingestChunk(
					db,
					fd,
					name,
					cursor,
					Math.min(1024 * 1024, remaining, stat.size - cursor.offset),
				);
				if (!read) break;
				remaining -= read;
			}
			coverage.pendingBytes += Math.max(0, stat.size - cursor.offset);
			if (cursor.offset >= stat.size) coverage.indexedFiles++;
			// Metadata replay has its own atomic cursor: migration never clears indexed history.
			const saved = db
				.prepare("SELECT data FROM rebill_files WHERE name=?")
				.get(name);
			const previousReplay: FileCursor | null =
				typeof saved?.["data"] === "string" ? JSON.parse(saved["data"]) : null;
			const replay: FileCursor =
				previousReplay?.rebillVersion === REBILL_VERSION
					? previousReplay
					: {
							...blankCursor(cursor.identity, cursor.rewrites),
							rebillVersion: REBILL_VERSION,
						};
			if (replay !== previousReplay)
				db.prepare(
					"INSERT INTO rebill_files VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data=excluded.data",
				).run(name, JSON.stringify(replay));
			while (
				remaining > 0 &&
				performance.now() < deadline &&
				replay.offset < cursor.offset
			) {
				const read = ingestChunk(
					db,
					fd,
					name,
					replay,
					Math.min(1024 * 1024, remaining, cursor.offset - replay.offset),
					true,
				);
				if (!read) break;
				remaining -= read;
			}
		} finally {
			closeSync(fd);
		}
	}
	for (const [name, cursor] of known) {
		if (!present.has(name)) coverage.missingFiles++;
		coverage.malformed += cursor.malformed;
		coverage.invalidUsage += cursor.invalidUsage;
		coverage.rewrittenFiles += cursor.rewrites > 0 ? 1 : 0;
		const tailBytes = Buffer.byteLength(cursor.tail, "base64");
		coverage.pendingBytes += tailBytes;
		if (tailBytes || cursor.discarding) coverage.partialFiles++;
	}
	for (const row of db
		.prepare(`SELECT files.data AS source, rebill_files.data AS replay
		FROM files LEFT JOIN rebill_files USING(name)`)
		.iterate()) {
		const source: FileCursor = JSON.parse(String(row["source"]));
		const replay: FileCursor | null =
			typeof row["replay"] === "string" ? JSON.parse(row["replay"]) : null;
		if (
			!replay ||
			replay.rebillVersion !== REBILL_VERSION ||
			replay.offset - Buffer.byteLength(replay.tail, "base64") <
				source.offset - Buffer.byteLength(source.tail, "base64")
		)
			coverage.rebillPendingFiles++;
	}
	return coverage;
}
