import type { BoardParams } from "./contract.js";

export interface PostRecord {
	message_id: string;
	channel_name: string;
	author: string;
	thread_id: string;
	created_at: string;
	text: string;
}
export const POST_COLUMNS =
	"id AS message_id,channel AS channel_name,author,root AS thread_id,created_at,text";
export function metadata({ text: _text, ...value }: PostRecord) {
	return value;
}
export function preview(post: PostRecord, chars: number) {
	const text = Array.from(post.text);
	return {
		...metadata(post),
		text_preview: text.slice(0, chars).join(""),
		n_chars: text.length,
		truncated: text.length > chars,
	};
}
export function window(params: BoardParams) {
	const limit = Math.min(params.limit ?? 20, 50);
	let offset = 0;
	if (params.cursor !== undefined) {
		const bytes = Buffer.from(params.cursor, "base64url");
		if (bytes.length !== 4 || bytes.toString("base64url") !== params.cursor)
			throw new Error("Invalid cursor");
		offset = bytes.readUInt32BE();
	}
	return { limit, offset };
}
export function page<T>(values: T[], params: BoardParams) {
	const { limit, offset } = window(params);
	const has_more = values.length > limit;
	const results = values.slice(0, limit);
	let next_cursor: string | null = null;
	if (has_more) {
		if (offset + results.length > 0xffffffff)
			throw new Error("Cursor exceeds board limit");
		const bytes = Buffer.alloc(4);
		bytes.writeUInt32BE(offset + results.length);
		next_cursor = bytes.toString("base64url");
	}
	return { results, n_returned: results.length, has_more, next_cursor };
}
export function budget(params: BoardParams, count: number) {
	return Math.min(
		params.max_chars_per_post ?? 1000,
		Math.floor(20000 / Math.max(1, count)),
	);
}
