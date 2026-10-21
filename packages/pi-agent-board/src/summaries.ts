import type { DatabaseSync } from "node:sqlite";
import { caseFold } from "unicode-case-folding";

export interface ThreadSummary {
	thread_id: string;
	status_message_id: string;
	through_message_id: string;
	created_at: string;
	provider: string;
	model: string;
	reasoning: string;
	text: string;
}

/** Derived closure snapshots, separate from posts and their activity/subscriptions. */
export class ThreadSummaries {
	readonly available: boolean;
	private readonly db: DatabaseSync;
	constructor(db: DatabaseSync, write: boolean) {
		this.db = db;
		if (write)
			db.exec(`CREATE TABLE IF NOT EXISTS thread_summaries (
			board_id TEXT NOT NULL, thread_id TEXT NOT NULL,
			status_message_id TEXT NOT NULL, through_message_id TEXT NOT NULL,
			created_at TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
			reasoning TEXT NOT NULL, text TEXT NOT NULL, body_search TEXT NOT NULL,
			PRIMARY KEY(board_id,thread_id));`);
		this.available = !!db
			.prepare(
				"SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_summaries'",
			)
			.get();
	}
	get(
		board: string,
		thread: string,
	): (ThreadSummary & { has_newer_posts: boolean }) | undefined {
		if (!this.available) return undefined;
		const row = this.db
			.prepare(
				`SELECT thread_id,status_message_id,through_message_id,created_at,provider,model,reasoning,text,
			EXISTS(SELECT 1 FROM posts p WHERE p.board_id=s.board_id AND p.root=s.thread_id
			AND p.seq>(SELECT seq FROM posts WHERE board_id=s.board_id AND id=s.through_message_id)) AS has_newer_posts
			FROM thread_summaries s WHERE board_id=? AND thread_id=?`,
			)
			.get(board, thread) as
			| (ThreadSummary & { has_newer_posts: number })
			| undefined;
		return row
			? { ...row, has_newer_posts: row.has_newer_posts === 1 }
			: undefined;
	}
	/** A late completion cannot restore a reopened/reclosed or changed snapshot. */
	save(board: string, summary: ThreadSummary): boolean {
		if (
			!summary.text.trim() ||
			!summary.text.isWellFormed() ||
			Buffer.byteLength(summary.text) > 65536
		)
			throw new Error("Summary must be 1-65536 UTF-8 bytes of nonempty text");
		if (
			![summary.provider, summary.model, summary.reasoning].every((value) =>
				value.trim(),
			)
		)
			throw new Error("Summary model metadata is required");
		const result = this.db
			.prepare(`INSERT INTO thread_summaries
			(board_id,thread_id,status_message_id,through_message_id,created_at,provider,model,reasoning,text,body_search)
			SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
				SELECT 1 FROM thread_statuses s WHERE s.board_id=? AND s.thread_id=?
				AND s.status<>'open' AND s.message_id=?
				AND (SELECT id FROM posts WHERE board_id=s.board_id AND root=s.thread_id ORDER BY seq DESC LIMIT 1)=?
			)
			ON CONFLICT(board_id,thread_id) DO UPDATE SET
			status_message_id=excluded.status_message_id,through_message_id=excluded.through_message_id,
			created_at=excluded.created_at,provider=excluded.provider,model=excluded.model,
			reasoning=excluded.reasoning,text=excluded.text,body_search=excluded.body_search`)
			.run(
				board,
				summary.thread_id,
				summary.status_message_id,
				summary.through_message_id,
				summary.created_at,
				summary.provider,
				summary.model,
				summary.reasoning,
				summary.text,
				caseFold(summary.text),
				board,
				summary.thread_id,
				summary.status_message_id,
				summary.through_message_id,
			);
		return result.changes === 1;
	}
	discard(board: string, thread: string): void {
		if (this.available)
			this.db
				.prepare(
					"DELETE FROM thread_summaries WHERE board_id=? AND thread_id=?",
				)
				.run(board, thread);
	}
}

export function summaryPreview(
	{
		text,
		provider: _provider,
		model: _model,
		reasoning: _reasoning,
		...metadata
	}: ThreadSummary & { has_newer_posts: boolean },
	chars: number,
) {
	const points = Array.from(text);
	return {
		...metadata,
		text_preview: points.slice(0, chars).join(""),
		n_chars: points.length,
		truncated: points.length > chars,
	};
}
