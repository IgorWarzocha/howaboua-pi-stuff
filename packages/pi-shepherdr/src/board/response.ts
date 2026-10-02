import type { BoardParams } from "./contract.js";

// Includes UTF-8 text, JSON escaping and metadata, in every tool mode.
const MAX_RESPONSE_BYTES = 8000;

export function serializeBoardResult(value: unknown): string {
	const text = JSON.stringify(value);
	if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
		throw new Error(
			"Result exceeds the output budget. Reduce limit or max_chars_per_post; use read_post with a smaller limit_chars for long posts.",
		);
	return text;
}

export function checkMutationBudget(caller: string, params: BoardParams) {
	// Native acknowledgement reserve, checked before opening or creating storage.
	const target = params.target_agent ?? "";
	if (
		2048 + Buffer.byteLength(caller) + Buffer.byteLength(target) >
		MAX_RESPONSE_BYTES
	)
		throw new Error(
			"Output budget is too small to acknowledge a message-board mutation; no change was made.",
		);
}

export function boundedBoardRead<T extends { value: unknown }>(
	params: BoardParams,
	fetch: (request: BoardParams) => T,
): T {
	const limit = Math.min(params.limit ?? 20, 50);
	const chars = Math.min(params.max_chars_per_post ?? 1000, 20000);
	const postChars = Math.min(params.limit_chars ?? 20000, 20000);
	const previews = ["list_threads", "search_posts", "read_thread"].includes(
		params.action,
	);
	const post = params.action === "read_post";
	const largest = post ? postChars : previews ? Math.max(limit, chars) : limit;
	for (let scale = 1; ; scale *= 2) {
		const reduced = (value: number) => Math.max(1, Math.floor(value / scale));
		// Reissue the original cursor/offset so continuation matches the reduced page.
		const result = fetch({
			...params,
			...(post
				? { limit_chars: reduced(postChars) }
				: { limit: reduced(limit) }),
			...(previews ? { max_chars_per_post: reduced(chars) } : {}),
		});
		if (Buffer.byteLength(JSON.stringify(result.value)) <= MAX_RESPONSE_BYTES)
			return result;
		if (Math.floor(largest / scale) <= 1)
			throw new Error(
				"The output budget is too small for this result's metadata.",
			);
	}
}
