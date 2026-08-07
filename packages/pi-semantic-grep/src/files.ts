import crypto from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SemanticGrepConfig } from "./config.js";

export interface TextChunk {
	file: string;
	startLine: number;
	endLine: number;
	text: string;
	hash: string;
	key: string;
}

export interface FileSnapshot {
	file: string;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	hash: string;
	text: string;
}

export interface FileMetadata {
	file: string;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
}

export function hashText(text: string): string {
	return crypto.createHash("sha256").update(text).digest("hex");
}

export function readFileSnapshot(
	root: string,
	metadata: FileMetadata,
): FileSnapshot | undefined {
	const abs = path.join(root, metadata.file);
	try {
		const before = statSync(abs);
		const text = readFileSync(abs, "utf8");
		const after = statSync(abs);
		if (
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs ||
			after.size !== metadata.size ||
			after.mtimeMs !== metadata.mtimeMs ||
			after.ctimeMs !== metadata.ctimeMs ||
			text.includes("\0")
		)
			return undefined;
		return {
			file: metadata.file,
			size: after.size,
			mtimeMs: after.mtimeMs,
			ctimeMs: after.ctimeMs,
			hash: hashText(text),
			text,
		};
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EACCES" || code === "EPERM")
			return undefined;
		throw error;
	}
}

function pushChunk(
	out: TextChunk[],
	file: string,
	startLine: number,
	endLine: number,
	text: string,
	fileHash: string,
	discriminator = "",
): void {
	const trimmed = text.trim();
	if (trimmed.length < 20) return;
	out.push({
		file,
		startLine,
		endLine,
		text: trimmed,
		hash: fileHash,
		key: hashText(`${startLine}:${endLine}:${discriminator}\0${trimmed}`),
	});
}

function pushOversizedLine(
	out: TextChunk[],
	file: string,
	line: number,
	text: string,
	fileHash: string,
	maxChars: number,
): void {
	for (let offset = 0; offset < text.length; offset += maxChars)
		pushChunk(
			out,
			file,
			line,
			line,
			text.slice(offset, offset + maxChars),
			fileHash,
			String(offset),
		);
}

export function chunkSnapshot(
	snapshot: FileSnapshot,
	config: SemanticGrepConfig,
): TextChunk[] {
	const lines = snapshot.text.split(/\r?\n/);
	const lineLimit = Math.max(1, config.indexing.chunkLines);
	const charLimit = Math.max(
		20,
		Math.min(config.indexing.maxChunkChars, config.indexing.maxEmbeddingChars),
	);
	const configuredOverlap = Math.max(0, config.indexing.chunkOverlap);
	const chunks: TextChunk[] = [];
	let start = 0;

	while (start < lines.length) {
		let end = start;
		let chars = 0;
		while (end < lines.length && end - start < lineLimit) {
			const nextChars = (lines[end]?.length ?? 0) + (end > start ? 1 : 0);
			if (end > start && chars + nextChars > charLimit) break;
			chars += nextChars;
			end++;
		}

		if (end === start) end++;
		const text = lines.slice(start, end).join("\n");
		if (text.length > charLimit) {
			if (!config.indexing.skipOversizedChunks)
				pushOversizedLine(
					chunks,
					snapshot.file,
					start + 1,
					text,
					snapshot.hash,
					charLimit,
				);
		} else {
			pushChunk(chunks, snapshot.file, start + 1, end, text, snapshot.hash);
		}

		if (end >= lines.length) break;
		const consumed = end - start;
		const overlap = Math.min(configuredOverlap, Math.max(0, consumed - 1));
		start = end - overlap;
	}
	return chunks;
}
