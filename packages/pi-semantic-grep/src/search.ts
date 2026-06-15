import type Database from "better-sqlite3";
import type { SemanticGrepConfig } from "./config.js";
import type { ChunkRow } from "./db.js";
import { cosine, embed } from "./embeddings.js";

export interface SearchMatch {
	file: string;
	startLine: number;
	endLine: number;
	score: number;
	text: string;
}

export async function searchDb(
	db: Database.Database,
	query: string,
	topK: number,
	config: SemanticGrepConfig,
	signal?: AbortSignal,
): Promise<SearchMatch[]> {
	const q = await embed(query, config, signal);
	const best: SearchMatch[] = [];
	let minBestScore = Number.NEGATIVE_INFINITY;

	for (const row of db
		.prepare("select file, start_line, end_line, text, vector from chunks")
		.iterate() as Iterable<ChunkRow>) {
		signal?.throwIfAborted();
		const score = cosine(q, JSON.parse(row.vector) as number[]);
		if (best.length >= topK && score <= minBestScore) continue;

		best.push({
			file: row.file,
			startLine: row.start_line,
			endLine: row.end_line,
			text: row.text,
			score,
		});
		best.sort((a, b) => b.score - a.score);
		if (best.length > topK) best.pop();
		minBestScore = best.at(-1)?.score ?? Number.NEGATIVE_INFINITY;
	}

	return best;
}

export function formatMatches(matches: SearchMatch[]): string {
	if (matches.length === 0)
		return "No semantic grep matches. Try running /semantic-grep-index first.";
	return matches
		.map((m, i) => {
			return `## ${i + 1}. ${m.file}:${m.startLine}-${m.endLine} score=${m.score.toFixed(4)}\n\n\`\`\`${m.file}\n${m.text}\n\`\`\``;
		})
		.join("\n\n");
}
