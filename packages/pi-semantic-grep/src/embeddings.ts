import type { SemanticGrepConfig } from "./config.js";

interface EmbeddingDatum {
	embedding?: number[];
	index?: number;
}

interface EmbeddingResponse {
	data?: EmbeddingDatum[];
}

type EmbeddingKind = "document" | "query";

function inputFor(
	input: string,
	kind: EmbeddingKind,
	config: SemanticGrepConfig,
): string {
	const prefix =
		kind === "query"
			? config.embeddings.queryPrefix
			: config.embeddings.documentPrefix;
	return `${prefix}${input}`;
}

function extraBodyFor(
	kind: EmbeddingKind,
	config: SemanticGrepConfig,
): Record<string, unknown> {
	return kind === "query"
		? config.embeddings.queryExtraBody
		: config.embeddings.documentExtraBody;
}

async function requestEmbeddings(
	inputs: string[],
	kind: EmbeddingKind,
	config: SemanticGrepConfig,
	signal?: AbortSignal,
): Promise<number[][]> {
	if (inputs.length === 0) return [];
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (config.embeddings.apiKey)
		headers["Authorization"] = `Bearer ${config.embeddings.apiKey}`;

	const prepared = inputs.map((input) => inputFor(input, kind, config));
	const body: Record<string, unknown> = {
		...extraBodyFor(kind, config),
		model: config.embeddings.model,
		input: prepared.length === 1 ? prepared[0] : prepared,
	};
	if (config.embeddings.dimensions !== undefined)
		body["dimensions"] = config.embeddings.dimensions;

	const res = await fetch(config.embeddings.url, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		...(signal ? { signal } : {}),
	});
	if (!res.ok)
		throw new Error(`embedding endpoint ${res.status}: ${await res.text()}`);
	const json = (await res.json()) as EmbeddingResponse;
	const data = json.data;
	if (!Array.isArray(data) || data.length !== prepared.length) {
		throw new Error(
			`embedding response contained ${data?.length ?? 0} vectors for ${prepared.length} inputs`,
		);
	}

	const ordered = [...data].sort(
		(a, b) => (a.index ?? data.indexOf(a)) - (b.index ?? data.indexOf(b)),
	);
	const vectors = ordered.map((item) => item.embedding);
	if (
		vectors.some(
			(vector) =>
				!Array.isArray(vector) ||
				vector.length === 0 ||
				vector.some(
					(value) => typeof value !== "number" || !Number.isFinite(value),
				),
		)
	)
		throw new Error("embedding response did not contain data[].embedding");
	const dimensions = vectors[0]?.length;
	if (!dimensions || vectors.some((vector) => vector?.length !== dimensions))
		throw new Error(
			"embedding response contained inconsistent vector dimensions",
		);
	return vectors as number[][];
}

export async function embedDocuments(
	inputs: string[],
	config: SemanticGrepConfig,
	signal?: AbortSignal,
): Promise<number[][]> {
	const batchSize = Math.max(1, Math.floor(config.embeddings.batchSize));
	const vectors: number[][] = [];
	for (let offset = 0; offset < inputs.length; offset += batchSize) {
		signal?.throwIfAborted();
		vectors.push(
			...(await requestEmbeddings(
				inputs.slice(offset, offset + batchSize),
				"document",
				config,
				signal,
			)),
		);
	}
	return vectors;
}

export async function embedQuery(
	input: string,
	config: SemanticGrepConfig,
	signal?: AbortSignal,
): Promise<number[]> {
	const [vector] = await requestEmbeddings([input], "query", config, signal);
	if (!vector)
		throw new Error("embedding response did not contain a query vector");
	return vector;
}

export function cosine(a: number[], b: number[]): number {
	let dot = 0,
		aa = 0,
		bb = 0;
	for (let i = 0; i < a.length; i++) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		aa += av * av;
		bb += bv * bv;
	}
	return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}
