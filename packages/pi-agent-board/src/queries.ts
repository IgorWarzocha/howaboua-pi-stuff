import { caseFold } from "unicode-case-folding";
import { type BoardParams, required } from "./contract.js";
import {
	budget,
	cursor,
	metadata,
	POST_COLUMNS,
	type PostRecord,
	page,
	preview,
	window,
} from "./paging.js";
import { searchBoard } from "./search.js";
import type { BoardStore } from "./store.js";
import { summaryPreview } from "./summaries.js";

export function queryBoard(
	store: BoardStore,
	ownBoard: string,
	params: BoardParams,
): Record<string, unknown> {
	const board = params.board_id ?? ownBoard;
	const { limit, offset } = window(params);
	const order = params.recent_first === false ? "ASC" : "DESC";
	if (params.action === "list_boards") {
		const rows = store.all<{
			board_id: string;
			root_session_id: string;
			owner_folder: string;
			created_at: string;
			last_activity_at: string;
			channel_count: number;
			message_count: number;
		}>(
			`SELECT b.*,
		COALESCE((SELECT MAX(created_at) FROM posts p WHERE p.board_id=b.board_id),(SELECT MAX(created_at) FROM channels c WHERE c.board_id=b.board_id),b.created_at) AS last_activity_at,
		(SELECT COUNT(*) FROM channels c WHERE c.board_id=b.board_id) AS channel_count,
		(SELECT COUNT(*) FROM posts p WHERE p.board_id=b.board_id) AS message_count
		FROM boards b ORDER BY last_activity_at DESC,board_id DESC LIMIT ? OFFSET ?`,
			limit + 1,
			offset,
		);
		return page(
			rows.map((row) => ({ ...row, current: row.board_id === ownBoard })),
			params,
		);
	}
	if (params.action === "get_channels") {
		const rows = store.all<{ name: string }>(
			`SELECT name FROM channels c WHERE board_id=? AND instr(name_search,?)>0 ORDER BY
		COALESCE((SELECT MAX(created_at) FROM posts p WHERE p.board_id=c.board_id AND p.channel=c.name),c.created_at) ${order},name ${order} LIMIT ? OFFSET ?`,
			board,
			caseFold(params.query ?? ""),
			limit + 1,
			offset,
		);
		return page(
			rows.map(({ name }) => store.channel(board, name)),
			params,
		);
	}
	if (params.action === "read_post") {
		const post = store.post(board, required(params.message_id, "message_id"));
		const chars = Array.from(post.text);
		const offset = Math.min(params.offset_chars ?? 0, chars.length);
		const text = chars
			.slice(offset, offset + Math.min(params.limit_chars ?? 20000, 20000))
			.join("");
		return {
			...metadata(post),
			text,
			n_chars: chars.length,
			next_offset_chars: offset + Array.from(text).length,
		};
	}
	if (params.action === "read_thread") {
		const root = store.root(board, required(params.thread_id, "thread_id"));
		const summary = params.full
			? undefined
			: store.summaries.get(board, root.thread_id);
		if (summary) {
			const points = Array.from(summary.text);
			const start = Math.min(offset, points.length);
			const text = points.slice(start, start + budget(params, 1)).join("");
			const next = start + Array.from(text).length;
			return {
				view: "summary",
				root_post: metadata(root),
				...store.threadStatus(board, root.thread_id),
				summary: {
					...summaryPreview(summary, 0),
					text_preview: text,
					offset_chars: start,
					truncated: next < points.length,
				},
				has_more: next < points.length,
				next_cursor: next < points.length ? cursor(next) : null,
			};
		}
		const replies = store.all<PostRecord>(
			`SELECT ${POST_COLUMNS} FROM posts WHERE board_id=? AND root=? AND id<>root ORDER BY created_at DESC,seq DESC LIMIT ? OFFSET ?`,
			board,
			root.message_id,
			limit + 1,
			offset,
		);
		const chars = budget(params, Math.min(replies.length, limit) + 1);
		return {
			view: "full",
			root_post: preview(root, chars),
			...store.threadStatus(board, root.thread_id),
			...page(
				replies.map((post) => preview(post, chars)),
				params,
			),
		};
	}
	if (params.action === "list_threads") {
		const channel = store.channel(
			board,
			required(params.channel_name, "channel_name"),
		);
		const sort =
			params.sort === "activity"
				? "(SELECT MAX(created_at) FROM posts r WHERE r.board_id=p.board_id AND r.root=p.id)"
				: "p.created_at";
		const roots = store.all<PostRecord>(
			`SELECT ${POST_COLUMNS} FROM posts p WHERE board_id=? AND channel=? AND id=root ORDER BY ${sort} ${order},seq ${order} LIMIT ? OFFSET ?`,
			board,
			channel.channel_name,
			limit + 1,
			offset,
		);
		const chars = budget(params, 2 * Math.min(roots.length, limit));
		return page(
			roots.map((root) => {
				const summary = store.summaries.get(board, root.thread_id);
				const reply = store.one<PostRecord>(
					`SELECT ${POST_COLUMNS} FROM posts WHERE board_id=? AND root=? AND id<>root ORDER BY created_at DESC,seq DESC LIMIT 1`,
					board,
					root.message_id,
				);
				const count =
					store.one<{ n: number }>(
						"SELECT COUNT(*) AS n FROM posts WHERE board_id=? AND root=? AND id<>root",
						board,
						root.message_id,
					)?.n ?? 0;
				return {
					thread_id: root.message_id,
					...store.threadStatus(board, root.message_id),
					...(summary
						? { summary: summaryPreview(summary, chars) }
						: { root_post: preview(root, chars) }),
					reply_count: count,
					last_activity_at:
						reply && reply.created_at > root.created_at
							? reply.created_at
							: root.created_at,
					...(summary
						? {}
						: { latest_reply: reply ? preview(reply, chars) : null }),
				};
			}),
			params,
		);
	}
	if (params.action === "search_posts")
		return searchBoard(store, board, params);
	throw new Error(`Unsupported board read: ${params.action}`);
}
