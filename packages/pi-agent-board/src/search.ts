import { caseFold } from "unicode-case-folding";
import { agentPath, type BoardParams } from "./contract.js";
import { budget, type PostRecord, page, preview, window } from "./paging.js";
import type { BoardStore } from "./store.js";
import { summaryPreview } from "./summaries.js";

/** Summaries replace their source posts, never supplement them in default search. */
export function searchBoard(
	store: BoardStore,
	board: string,
	params: BoardParams,
) {
	const { limit, offset } = window(params);
	const summarized = store.summaries.available && !params.full;
	const clauses = ["board_id=?"];
	const args: (string | number)[] = [board];
	if (params.channel_name !== undefined) {
		clauses.push("channel_name=?");
		args.push(params.channel_name);
	}
	if (params.author !== undefined) {
		clauses.push(`(author=? OR (kind='summary' AND EXISTS (
			SELECT 1 FROM posts a WHERE a.board_id=c.board_id AND a.root=c.thread_id AND a.author=?)))`);
		const author = agentPath(params.author, "/root");
		args.push(author, author);
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
	const rows = store.all<
		| (PostRecord & { kind: "post" })
		| (Omit<PostRecord, "author"> & { kind: "summary"; author: null })
	>(
		`WITH candidates AS (
			SELECT p.board_id,p.id AS message_id,p.channel AS channel_name,p.author,p.root AS thread_id,
			p.created_at,p.text,p.body_search,p.seq,'post' AS kind FROM posts p
			${summarized ? "WHERE NOT EXISTS (SELECT 1 FROM thread_summaries s WHERE s.board_id=p.board_id AND s.thread_id=p.root)" : ""}
			${
				summarized
					? `UNION ALL
			SELECT s.board_id,p.id,p.channel,NULL,s.thread_id,p.created_at,s.text,s.body_search,p.seq,'summary'
			FROM thread_summaries s JOIN posts p ON p.board_id=s.board_id AND p.id=s.through_message_id`
					: ""
			}
		) SELECT * FROM candidates c WHERE ${clauses.join(" AND ")}
		ORDER BY created_at DESC,seq DESC LIMIT ? OFFSET ?`,
		...args,
		limit + 1,
		offset,
	);
	const chars = budget(params, Math.min(rows.length, limit));
	return page(
		rows.map((row) => {
			const status = store.threadStatus(board, row.thread_id);
			if (row.kind === "summary") {
				const summary = store.summaries.get(board, row.thread_id);
				if (!summary)
					throw new Error(
						"Thread summary is no longer available; repeat the search",
					);
				return {
					kind: "summary",
					thread_id: row.thread_id,
					channel_name: row.channel_name,
					...status,
					summary: summaryPreview(summary, chars),
				};
			}
			// Do not expose SQL-only columns as post metadata.
			const post: PostRecord = {
				message_id: row.message_id,
				channel_name: row.channel_name,
				author: row.author,
				thread_id: row.thread_id,
				created_at: row.created_at,
				text: row.text,
			};
			return { kind: "post", ...preview(post, chars), ...status };
		}),
		params,
	);
}
