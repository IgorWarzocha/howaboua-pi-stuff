import { caseFold } from "unicode-case-folding";
import { agentPath, type BoardParams, required } from "./contract.js";
import {
	budget,
	metadata,
	POST_COLUMNS,
	type PostRecord,
	page,
	preview,
	window,
} from "./paging.js";
import type { BoardStore } from "./store.js";

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
		const replies = store.all<PostRecord>(
			`SELECT ${POST_COLUMNS} FROM posts WHERE board_id=? AND root=? AND id<>root ORDER BY created_at DESC,seq DESC LIMIT ? OFFSET ?`,
			board,
			root.message_id,
			limit + 1,
			offset,
		);
		const chars = budget(params, Math.min(replies.length, limit) + 1);
		return {
			root_post: preview(root, chars),
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
					root_post: preview(root, chars),
					reply_count: count,
					last_activity_at:
						reply && reply.created_at > root.created_at
							? reply.created_at
							: root.created_at,
					latest_reply: reply ? preview(reply, chars) : null,
				};
			}),
			params,
		);
	}
	if (params.action === "search_posts") return search(store, board, params);
	throw new Error(`Unsupported board read: ${params.action}`);
}

function search(store: BoardStore, board: string, params: BoardParams) {
	const { limit, offset } = window(params);
	const clauses = ["board_id=?"];
	const args: (string | number)[] = [board];
	if (params.channel_name !== undefined) {
		clauses.push("channel=?");
		args.push(params.channel_name);
	}
	if (params.author !== undefined) {
		clauses.push("author=?");
		args.push(agentPath(params.author, "/root"));
	}
	if (params.query !== undefined) {
		clauses.push("instr(body_search,?)>0");
		args.push(caseFold(params.query));
	}
	if (params.after_message_id !== undefined) {
		const after = store.one<{ created_at: string; seq: number }>(
			"SELECT created_at,seq FROM posts WHERE board_id=? AND id=?",
			board,
			params.after_message_id,
		);
		if (!after) throw new Error("Post not found in this board");
		clauses.push("(created_at,seq)>(?,?)");
		args.push(after.created_at, after.seq);
	}
	const posts = store.all<PostRecord>(
		`SELECT ${POST_COLUMNS} FROM posts WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC,seq DESC LIMIT ? OFFSET ?`,
		...args,
		limit + 1,
		offset,
	);
	const chars = budget(params, Math.min(posts.length, limit));
	return page(
		posts.map((post) => preview(post, chars)),
		params,
	);
}
