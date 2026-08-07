import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { SemanticGrepConfig } from "./config.js";
import { completeBuild, type FileRow, prepareBuildTarget } from "./db.js";
import { discoverFiles } from "./discovery.js";
import { embedDocuments } from "./embeddings.js";
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
): void {
	const { chunks, snapshot } = job;
	const insertFile = db.prepare(`
    insert into files (
      file, hash, size, mtime_ms, indexed_at,
      index_fingerprint, index_generation, chunk_count
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(file) do update set
      hash = excluded.hash,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      indexed_at = excluded.indexed_at,
      index_fingerprint = excluded.index_fingerprint,
      index_generation = excluded.index_generation,
      chunk_count = excluded.chunk_count
  `);
	const insertChunk = db.prepare(`
    insert into chunks (
      file, start_line, end_line, text, hash, vector, chunk_key
    ) values (?, ?, ?, ?, ?, ?, ?)
  `);
	const commit = db.transaction(() => {
		db.prepare("delete from chunks where file = ?").run(snapshot.file);
		insertFile.run(
			snapshot.file,
			snapshot.hash,
			snapshot.size,
			snapshot.mtimeMs,
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
		commitFile(db, job, vectors.slice(offset, next), fingerprint, generation);
		offset = next;
	}
	return chunks.length;
}

function updateMetadata(db: Database.Database, metadata: FileMetadata): void {
	db.prepare(
		"update files set size = ?, mtime_ms = ?, indexed_at = ? where file = ?",
	).run(
		metadata.size,
		metadata.mtimeMs,
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
): Promise<IndexStats> {
	const fingerprint = indexFingerprint(config);
	const target = prepareBuildTarget(db, fingerprint, forceFullRebuild);
	onProgress?.("scanning project files");
	const discovery = discoverFiles(root, config);
	const current = new Set(discovery.files.map((file) => file.file));
	const knownRows = db
		.prepare(`
      select file, hash, size, mtime_ms, indexed_at,
             index_fingerprint, index_generation, chunk_count
      from files
    `)
		.all() as FileRow[];
	const known = new Map(knownRows.map((row) => [row.file, row]));

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
			signal,
		);
		pendingJobs.length = 0;
		pendingChunks = 0;
	};

	const removeDeleted = db.transaction(() => {
		for (const row of knownRows) {
			if (current.has(row.file)) continue;
			db.prepare("delete from files where file = ?").run(row.file);
			deleted++;
		}
	});
	removeDeleted();

	for (let i = 0; i < discovery.files.length; i++) {
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
			old.mtime_ms === metadata.mtimeMs
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
			updateMetadata(db, metadata);
			metadataOnly++;
			continue;
		}

		if (old) changed++;
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

	completeBuild(db, target, config.embeddings.model);
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
