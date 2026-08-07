import type Database from "better-sqlite3";
import type { SemanticGrepConfig } from "./config.js";
import type { ChunkRow } from "./db.js";
import { cosine, embedQuery } from "./embeddings.js";

export interface SearchMatch {
	file: string;
	startLine: number;
	endLine: number;
	score: number;
	text: string;
}

export interface SearchResults {
	matches: SearchMatch[];
	skippedIncompatible: number;
}

const MAX_OUTPUT_BYTES = 45_000;

export async function searchDb(
	db: Database.Database,
	query: string,
	topK: number,
	config: SemanticGrepConfig,
	signal?: AbortSignal,
): Promise<SearchResults> {
	const q = await embedQuery(query, config, signal);
	const best: SearchMatch[] = [];
	let minBestScore = Number.NEGATIVE_INFINITY;
	let skippedIncompatible = 0;

	for (const row of db
		.prepare("select file, start_line, end_line, text, vector from chunks")
		.iterate() as Iterable<ChunkRow>) {
		signal?.throwIfAborted();
		let vector: number[];
		try {
			vector = JSON.parse(row.vector) as number[];
		} catch {
			skippedIncompatible++;
			continue;
		}
		if (
			!Array.isArray(vector) ||
			vector.length !== q.length ||
			vector.some(
				(value) => typeof value !== "number" || !Number.isFinite(value),
			)
		) {
			skippedIncompatible++;
			continue;
		}
		const score = cosine(q, vector);
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

	return { matches: best, skippedIncompatible };
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

export function formatMatches(results: SearchResults): string {
	if (results.matches.length === 0) {
		if (results.skippedIncompatible > 0)
			return `No compatible semantic grep vectors. ${results.skippedIncompatible} stale chunks were omitted; let indexing finish or rebuild the index.`;
		return "No semantic grep matches.";
	}

	const sections: string[] = [];
	let used = 0;
	for (const [index, match] of results.matches.entries()) {
		const heading = `## ${index + 1}. ${match.file}:${match.startLine}-${match.endLine} score=${match.score.toFixed(4)}\n\n\`\`\`${match.file}\n`;
		const suffix = "\n```";
		const remaining =
			MAX_OUTPUT_BYTES - used - byteLength(heading) - byteLength(suffix);
		if (remaining <= 200) {
			sections.push(
				`… ${results.matches.length - index} additional matches omitted.`,
			);
			break;
		}
		let text = match.text;
		while (byteLength(text) > remaining - 24 && text.length > 0)
			text = text.slice(0, Math.floor(text.length * 0.9));
		const truncated = text.length < match.text.length;
		const section = `${heading}${text}${truncated ? "\n… snippet truncated" : ""}${suffix}`;
		sections.push(section);
		used += byteLength(section) + 2;
		if (truncated) {
			sections.push(
				`… ${results.matches.length - index - 1} additional matches omitted.`,
			);
			break;
		}
	}
	if (results.skippedIncompatible > 0)
		sections.push(
			`${results.skippedIncompatible} stale chunks were omitted; indexing will replace them.`,
		);
	return sections.join("\n\n");
}
