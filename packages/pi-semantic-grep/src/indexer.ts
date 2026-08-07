import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { SemanticGrepConfig } from "./config.js";
import { completeBuild, type FileRow, prepareBuildTarget } from "./db.js";
import { type DiscoveryResult, discoverFiles } from "./discovery.js";
import { embedDocuments } from "./embeddings.js";
import { nextEventLoopTurn } from "./event-loop.js";
import {
	chunkSnapshot,
	type FileMetadata,
	type FileSnapshot,
	readFileSnapshot,
	type TextChunk,
} from "./files.js";

export interface IndexStats {
	files: number;
	chunks: number;
	added: number;
	changed: number;
	unchanged: number;
	metadataOnly: number;
	deleted: number;
	skipped: number;
	fullRebuild: boolean;
	complete: boolean;
	discovery: "filesystem" | "git";
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => [key, canonical(item)]),
	);
}

export function indexFingerprint(config: SemanticGrepConfig): string {
	const payload = canonical({
		schema: 5,
		model: config.embeddings.model,
		dimensions: config.embeddings.dimensions ?? null,
		documentPrefix: config.embeddings.documentPrefix,
		documentExtraBody: config.embeddings.documentExtraBody,
		chunkLines: config.indexing.chunkLines,
		chunkOverlap: config.indexing.chunkOverlap,
		maxChunkChars: config.indexing.maxChunkChars,
		maxEmbeddingChars: config.indexing.maxEmbeddingChars,
		skipOversizedChunks: config.indexing.skipOversizedChunks,
	});
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex");
}

function formattedChunk(chunk: {
	file: string;
	startLine: number;
	endLine: number;
	text: string;
}): string {
	return `File: ${chunk.file}\nLines: ${chunk.startLine}-${chunk.endLine}\n\n${chunk.text}`;
}

interface FileJob {
	snapshot: FileSnapshot;
	chunks: TextChunk[];
}

function commitFile(
	db: Database.Database,
	job: FileJob,
	vectors: number[][],
	fingerprint: string,
	generation: number,
	staging: boolean,
): void {
	const { chunks, snapshot } = job;
	const filesTable = staging ? "staged_files" : "files";
	const chunksTable = staging ? "staged_chunks" : "chunks";
	const insertFile = db.prepare(`
    insert into ${filesTable} (
      file, hash, size, mtime_ms, ctime_ms, indexed_at,
      index_fingerprint, index_generation, chunk_count
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(file) do update set
      hash = excluded.hash,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      ctime_ms = excluded.ctime_ms,
      indexed_at = excluded.indexed_at,
      index_fingerprint = excluded.index_fingerprint,
      index_generation = excluded.index_generation,
      chunk_count = excluded.chunk_count
  `);
	const insertChunk = db.prepare(`
    insert into ${chunksTable} (
      file, start_line, end_line, text, hash, vector, chunk_key
    ) values (?, ?, ?, ?, ?, ?, ?)
	`);
	const commit = db.transaction(() => {
		db.prepare(`delete from ${chunksTable} where file = ?`).run(snapshot.file);
		insertFile.run(
			snapshot.file,
			snapshot.hash,
			snapshot.size,
			snapshot.mtimeMs,
			snapshot.ctimeMs,
			new Date().toISOString(),
			fingerprint,
			generation,
			chunks.length,
		);
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			const vector = vectors[i];
			if (!chunk || !vector)
				throw new Error(`missing embedded chunk ${i} for ${snapshot.file}`);
			insertChunk.run(
				chunk.file,
				chunk.startLine,
				chunk.endLine,
				chunk.text,
				chunk.hash,
				JSON.stringify(vector),
				chunk.key,
			);
		}
	});
	commit();
}

async function embedAndCommitJobs(
	db: Database.Database,
	jobs: FileJob[],
	config: SemanticGrepConfig,
	fingerprint: string,
	generation: number,
	staging: boolean,
	signal?: AbortSignal,
): Promise<number> {
	const chunks = jobs.flatMap((job) => job.chunks);
	const vectors = await embedDocuments(
		chunks.map(formattedChunk),
		config,
		signal,
	);
	if (vectors.length !== chunks.length)
		throw new Error(
			`embedding response contained ${vectors.length} vectors for ${chunks.length} queued chunks`,
		);
	signal?.throwIfAborted();
	let offset = 0;
	for (const job of jobs) {
		const next = offset + job.chunks.length;
		commitFile(
			db,
			job,
			vectors.slice(offset, next),
			fingerprint,
			generation,
			staging,
		);
		offset = next;
	}
	return chunks.length;
}

function updateMetadata(
	db: Database.Database,
	metadata: FileMetadata,
	staging: boolean,
): void {
	const table = staging ? "staged_files" : "files";
	db.prepare(
		`update ${table} set size = ?, mtime_ms = ?, ctime_ms = ?, indexed_at = ? where file = ?`,
	).run(
		metadata.size,
		metadata.mtimeMs,
		metadata.ctimeMs,
		new Date().toISOString(),
		metadata.file,
	);
}

export async function syncIndex(
	db: Database.Database,
	root: string,
	config: SemanticGrepConfig,
	forceFullRebuild = false,
	signal?: AbortSignal,
	onProgress?: (msg: string) => void,
	providedDiscovery?: DiscoveryResult,
): Promise<IndexStats> {
	const fingerprint = indexFingerprint(config);
	const target = prepareBuildTarget(db, fingerprint, forceFullRebuild);
	if (!providedDiscovery) onProgress?.("scanning project files");
	const discovery = providedDiscovery ?? (await discoverFiles(root, config));
	const current = new Set(discovery.files.map((file) => file.file));
	const filesTable = target.fullRebuild ? "staged_files" : "files";
	const knownRows = db
		.prepare(`
      select file, hash, size, mtime_ms, ctime_ms, indexed_at,
             index_fingerprint, index_generation, chunk_count
      from ${filesTable}
    `)
		.all() as FileRow[];
	const known = new Map(knownRows.map((row) => [row.file, row]));
	const activeRows = target.fullRebuild
		? (db
				.prepare(`
            select file, hash, size, mtime_ms, ctime_ms, indexed_at,
                   index_fingerprint, index_generation, chunk_count
            from files
          `)
				.all() as FileRow[])
		: knownRows;
	const active = new Map(activeRows.map((row) => [row.file, row]));

	let chunks = 0,
		added = 0,
		changed = 0,
		unchanged = 0,
		metadataOnly = 0,
		deleted = 0,
		skipped = discovery.skipped;
	const pendingJobs: FileJob[] = [];
	let pendingChunks = 0;
	const flushJobs = async (): Promise<void> => {
		if (pendingJobs.length === 0) return;
		chunks += await embedAndCommitJobs(
			db,
			pendingJobs,
			config,
			target.fingerprint,
			target.generation,
			target.fullRebuild,
			signal,
		);
		pendingJobs.length = 0;
		pendingChunks = 0;
	};

	for (let i = 0; i < discovery.files.length; i++) {
		if (i % 32 === 0) await nextEventLoopTurn();
		signal?.throwIfAborted();
		const metadata = discovery.files[i];
		if (!metadata) continue;
		const old = known.get(metadata.file);
		const currentGeneration =
			old?.index_fingerprint === target.fingerprint &&
			old.index_generation === target.generation &&
			old.chunk_count >= 0;
		if (
			currentGeneration &&
			old.size === metadata.size &&
			old.mtime_ms === metadata.mtimeMs &&
			old.ctime_ms === metadata.ctimeMs
		) {
			unchanged++;
			continue;
		}

		const snapshot = readFileSnapshot(root, metadata);
		if (!snapshot) {
			skipped++;
			continue;
		}
		if (currentGeneration && old.hash === snapshot.hash) {
			updateMetadata(db, metadata, target.fullRebuild);
			metadataOnly++;
			continue;
		}

		if (old || active.has(metadata.file)) changed++;
		else added++;
		onProgress?.(
			`[${i + 1}/${discovery.files.length}] indexing ${metadata.file}`,
		);
		const fileChunks = chunkSnapshot(snapshot, config);
		pendingJobs.push({ snapshot, chunks: fileChunks });
		pendingChunks += fileChunks.length;
		if (
			pendingChunks >= Math.max(1, config.embeddings.batchSize) ||
			pendingJobs.length >= Math.max(1, config.embeddings.batchSize)
		)
			await flushJobs();
	}
	await flushJobs();

	const normalizedUnavailableDirectories = discovery.unavailableDirectories.map(
		(dir) => (dir ? `${dir.split("\\").join("/")}/` : ""),
	);
	const preserved = (file: string): boolean => {
		const normalized = file.split("\\").join("/");
		return (
			discovery.unavailableFiles.has(file) ||
			normalizedUnavailableDirectories.some(
				(dir) => dir === "" || normalized.startsWith(dir),
			)
		);
	};
	const deletedFiles = activeRows
		.filter((row) => !current.has(row.file) && !preserved(row.file))
		.map((row) => row.file);
	const complete = !target.fullRebuild || skipped === 0;
	if (complete) {
		deleted = deletedFiles.length;
		if (target.fullRebuild) {
			const removeStaleStaging = db.transaction(() => {
				for (const row of knownRows) {
					if (!current.has(row.file))
						db.prepare("delete from staged_files where file = ?").run(row.file);
				}
			});
			removeStaleStaging();
		} else {
			const removeDeleted = db.transaction(() => {
				for (const file of deletedFiles)
					db.prepare("delete from files where file = ?").run(file);
			});
			removeDeleted();
		}
		completeBuild(db, target, config.embeddings.model);
	}
	return {
		files: discovery.files.length,
		chunks,
		added,
		changed,
		unchanged,
		metadataOnly,
		deleted,
		skipped,
		fullRebuild: target.fullRebuild,
		complete,
		discovery: discovery.source,
	};
}

export async function buildIndex(
	db: Database.Database,
	root: string,
	config: SemanticGrepConfig,
	signal?: AbortSignal,
	onProgress?: (msg: string) => void,
): Promise<IndexStats> {
	return syncIndex(db, root, config, true, signal, onProgress);
}
