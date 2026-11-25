import { minuteTimestamp } from "../timestamps.js";
import type { BoardParams } from "./contract.js";

// Includes UTF-8 text, JSON escaping and metadata, in every tool mode.
const MAX_RESPONSE_BYTES = 8000;

const MUTATION_BUDGET_ERROR =
	"Board acknowledgement exceeds budget. No change.";

export function serializeBoardResult(
	value: unknown,
	beforeCommit = false,
): string {
	const text = JSON.stringify(value, (key, entry) =>
		(key === "created_at" || key === "last_activity_at") &&
		typeof entry === "string"
			? minuteTimestamp(entry)
			: entry,
	);
	if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
		throw new Error(
			beforeCommit
				? MUTATION_BUDGET_ERROR
				: "Board result exceeds budget. Reduce limit, max_chars_per_post, or read_post limit_chars.",
		);
	return text;
}

/** Keep the runtime's full acknowledgements out of native and nested tool output. */
export function serializeBoardToolResult(
	value: unknown,
	action: BoardParams["action"] | undefined,
): string {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return serializeBoardResult(value);
	const result: Record<string, unknown> = { ...value };
	if (action === "post" || action === "set_status") {
		delete result["author"];
		delete result["created_at"];
	} else if (action === "create_channel") {
		delete result["created_at"];
		delete result["created_by"];
		delete result["message_count"];
		delete result["last_message_id"];
	}
	return serializeBoardResult(result);
}

export function checkMutationBudget(caller: string, params: BoardParams) {
	// Native acknowledgement reserve, checked before opening or creating storage.
	const target = params.target_agent ?? "";
	if (
		2048 + Buffer.byteLength(caller) + Buffer.byteLength(target) >
		MAX_RESPONSE_BYTES
	)
		throw new Error(MUTATION_BUDGET_ERROR);
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
				"Board metadata exceeds budget even on the smallest page.",
			);
	}
}
