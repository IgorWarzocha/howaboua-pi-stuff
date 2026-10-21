import { open, opendir, stat } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { createIngestor } from "./ingest.ts";
import { object } from "./normalise.ts";
import { createProvenance } from "./provenance.ts";

const CHUNK_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 32 * 1024 * 1024;

interface FileState {
	id: number;
	path: string;
	identity: string;
	offset: number;
	line: number;
	tail: Buffer;
	skipping: number;
	mtime: number;
	project: string;
	blocked: number;
	malformed: number;
}

interface Candidate {
	path: string;
	identity: string;
	size: number;
	mtime: number;
}

async function discover(root: string, optional = false): Promise<Candidate[]> {
	const files: Candidate[] = [];
	async function walk(path: string): Promise<void> {
		let directory: Awaited<ReturnType<typeof opendir>>;
		try {
			directory = await opendir(path);
		} catch (error) {
			if (
				optional &&
				path === root &&
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			)
				return;
			throw error;
		}
		for await (const entry of directory) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				try {
					const info = await stat(full);
					files.push({
						path: full,
						identity: `${info.dev}:${info.ino}`,
						size: info.size,
						mtime: info.mtimeMs,
					});
				} catch (error) {
					if (
						!(
							error instanceof Error &&
							"code" in error &&
							error.code === "ENOENT"
						)
					)
						throw error;
				}
			}
		}
	}
	await walk(root);
	return files.sort(
		(a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path),
	);
}

export function createIndexer(
	db: Database.Database,
	root: string,
	observationsRoot?: string,
) {
	const ingest = createIngestor(db);
	const provenance = createProvenance(db);
	const missingHeaders = db.prepare<[number], FileState>(`
		SELECT f.* FROM files f LEFT JOIN session_headers h ON h.file_id=f.id
		WHERE h.file_id IS NULL AND f.offset>0 AND f.blocked=0 AND f.id>?
		ORDER BY f.id LIMIT 64
	`);
	const getFile = db.prepare<[string], FileState>(
		"SELECT * FROM files WHERE path=?",
	);
	const cursors = db.prepare<
		[],
		Pick<FileState, "path" | "identity" | "offset" | "mtime" | "blocked">
	>("SELECT path,identity,offset,mtime,blocked FROM files");
	const putFile = db.prepare(
		"INSERT OR IGNORE INTO files(path,identity) VALUES (?,?)",
	);
	const checkpoint =
		db.prepare(`UPDATE files SET offset=@offset,line=@line,tail=@tail,skipping=@skipping,
		mtime=@mtime,malformed=@malformed WHERE id=@id`);
	const issue = db.prepare("UPDATE files SET issue=?,blocked=? WHERE id=?");
	const putMeta = db.prepare(
		"INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	);
	const revision = db.prepare(
		"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
	);
	let bytesRead = 0;
	let stopped = false;
	let lastScan: string | null = null;

	async function recoverHeaders(keepGoing: () => boolean): Promise<void> {
		let cursor = 0;
		while (!stopped && keepGoing()) {
			const batch = missingHeaders.all(cursor);
			if (!batch.length) return;
			for (const file of batch) {
				if (stopped || !keepGoing()) return;
				cursor = file.id;
				let handle;
				try {
					handle = await open(file.path, "r");
					const info = await handle.stat();
					if (
						`${info.dev}:${info.ino}` !== file.identity ||
						info.size < file.offset ||
						(info.size === file.offset && info.mtimeMs !== file.mtime)
					)
						continue;
					// Native session headers are small. Never replay bodies or alter source cursors.
					const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, file.offset));
					const first = await handle.read(
						buffer,
						0,
						Math.min(1024, buffer.length),
						0,
					);
					let length = first.bytesRead;
					let end = buffer.subarray(0, length).indexOf(10);
					if (end < 0 && length < buffer.length) {
						const rest = await handle.read(
							buffer,
							length,
							buffer.length - length,
							length,
						);
						length += rest.bytesRead;
						end = buffer.subarray(0, length).indexOf(10);
					}
					bytesRead += length;
					let record = {};
					if (end >= 0) {
						try {
							record = object(
								JSON.parse(buffer.subarray(0, end).toString("utf8")),
							);
						} catch (error) {
							if (!(error instanceof SyntaxError)) throw error;
						}
					}
					db.transaction(() => {
						provenance.recordHeader(file.id, record);
						revision.run();
					})();
				} catch (error) {
					if (
						!(
							error instanceof Error &&
							"code" in error &&
							error.code === "ENOENT"
						)
					)
						throw error;
				} finally {
					await handle?.close();
				}
			}
		}
	}

	async function changedFiles(): Promise<Candidate[]> {
		const files = (
			await Promise.all([
				discover(root),
				observationsRoot ? discover(observationsRoot, true) : [],
			])
		)
			.flat()
			.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
		const known = new Map(cursors.all().map((file) => [file.path, file]));
		return files.filter((candidate) => {
			const file = known.get(candidate.path);
			return (
				!file ||
				(!file.blocked &&
					(file.identity !== candidate.identity ||
						file.offset !== candidate.size ||
						(file.offset > 0 && file.mtime !== candidate.mtime)))
			);
		});
	}

	function progress(phase: string, error: string | null = null): void {
		putMeta.run(
			"indexStatus",
			JSON.stringify({ phase, bytesRead, lastScan, error }),
		);
	}

	const consume = db.transaction(
		(file: FileState, chunk: Buffer, mtime: number) => {
			let data = file.tail.length ? Buffer.concat([file.tail, chunk]) : chunk;
			file.offset += chunk.length;
			file.mtime = mtime;
			if (file.skipping) {
				const end = data.indexOf(10);
				if (end < 0) {
					checkpoint.run(file);
					return;
				}
				data = data.subarray(end + 1);
				file.skipping = 0;
				file.line++;
			}
			let start = 0;
			for (
				let end = data.indexOf(10);
				end >= 0;
				end = data.indexOf(10, start)
			) {
				file.line++;
				const raw = data.subarray(start, end);
				start = end + 1;
				if (!raw.length) continue;
				try {
					if (raw.length > MAX_LINE_BYTES)
						throw new Error("line exceeds 32 MiB");
					const value: unknown = JSON.parse(raw.toString("utf8"));
					const record = object(value);
					if (typeof record["type"] !== "string")
						throw new Error("record has no type");
					ingest(file, file.line, record);
				} catch (error) {
					// Invalid input is counted. SQLite/programming errors must stop the transaction, not lose an entry.
					if (
						!(error instanceof SyntaxError) &&
						!(
							error instanceof Error &&
							["line exceeds 32 MiB", "record has no type"].includes(
								error.message,
							)
						)
					)
						throw error;
					file.malformed++;
					issue.run(`Skipped line ${file.line}: ${error.message}`, 0, file.id);
				}
			}
			file.tail = Buffer.from(data.subarray(start));
			if (file.tail.length > MAX_LINE_BYTES) {
				file.tail = Buffer.alloc(0);
				file.skipping = 1;
				file.malformed++;
				issue.run(
					`Skipped line ${file.line + 1}: line exceeds 32 MiB`,
					0,
					file.id,
				);
			}
			checkpoint.run(file);
			revision.run();
		},
	);

	async function index(
		candidate: Candidate,
		keepGoing: () => boolean,
	): Promise<boolean> {
		putFile.run(candidate.path, candidate.identity);
		const file = getFile.get(candidate.path);
		if (!file || file.blocked) return false;
		if (
			file.identity !== candidate.identity ||
			candidate.size < file.offset ||
			(file.offset > 0 &&
				candidate.size === file.offset &&
				file.mtime !== candidate.mtime)
		) {
			issue.run(
				"File replaced, shortened or rewritten behind its cursor. Indexed history retained; use a fresh --db path to rebuild.",
				1,
				file.id,
			);
			revision.run();
			return false;
		}
		if (candidate.size === file.offset) return false;
		const handle = await open(file.path, "r");
		try {
			const info = await handle.stat();
			if (
				`${info.dev}:${info.ino}` !== file.identity ||
				info.size < candidate.size
			)
				throw new Error("File changed while opening; retry on the next scan");
			let buffered = 0;
			let chunks: Buffer[] = [];
			const startedAt = file.offset;
			while (
				!stopped &&
				keepGoing() &&
				file.offset + buffered < candidate.size &&
				(file.offset - startedAt < 4 * 1024 * 1024 || buffered > 0)
			) {
				const buffer = Buffer.allocUnsafe(
					Math.min(CHUNK_BYTES, candidate.size - file.offset - buffered),
				);
				const read = await handle.read(
					buffer,
					0,
					buffer.length,
					file.offset + buffered,
				);
				if (!read.bytesRead)
					throw new Error(
						"File shortened while indexing; choose a fresh --db path to rebuild",
					);
				const chunk = buffer.subarray(0, read.bytesRead);
				chunks.push(chunk);
				buffered += read.bytesRead;
				bytesRead += read.bytesRead;
				// Persist complete lines in batches; do not rewrite a growing multi-megabyte image line for every chunk.
				if (
					chunk.includes(10) ||
					buffered + file.tail.length > MAX_LINE_BYTES ||
					file.offset + buffered === candidate.size
				) {
					consume(
						file,
						chunks.length === 1 ? chunk : Buffer.concat(chunks, buffered),
						candidate.mtime,
					);
					buffered = 0;
					chunks = [];
				}
				progress("indexing");
			}
			if (!file.malformed) issue.run(null, 0, file.id);
			return file.offset < candidate.size;
		} finally {
			await handle.close();
		}
	}

	async function scan(keepGoing: () => boolean = () => true): Promise<void> {
		progress("indexing");
		try {
			await recoverHeaders(keepGoing);
			let candidates = await changedFiles();
			let refreshedAt = Date.now();
			let position = 0;
			while (!stopped && keepGoing() && position < candidates.length) {
				const candidate = candidates[position++];
				if (!candidate) continue;
				try {
					if (await index(candidate, keepGoing)) candidates.push(candidate);
				} catch (error) {
					const file = getFile.get(candidate.path);
					if (file)
						issue.run(
							error instanceof Error ? error.message : String(error),
							0,
							file.id,
						);
					else throw error;
				}
				// New files and active tails must not wait behind the entire historical backfill.
				if (Date.now() - refreshedAt >= 2000) {
					candidates = await changedFiles();
					position = 0;
					refreshedAt = Date.now();
				}
			}
			lastScan = new Date().toISOString();
			progress("idle");
		} catch (error) {
			progress("error", error instanceof Error ? error.message : String(error));
		}
	}
	progress("starting");
	return {
		scan,
		stop: () => {
			stopped = true;
		},
	};
}
