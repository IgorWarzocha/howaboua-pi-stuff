import { statSync } from "node:fs";
import {
	DatabaseSync,
	type SQLInputValue,
	type SQLOutputValue,
} from "node:sqlite";
import { caseFold } from "unicode-case-folding";
import type {
	BoardDetail,
	BoardIndex,
	BoardSummary,
	DiscussionSummary,
	Post,
	ThreadDetail,
	ThreadPage,
	ThreadStatus,
	ViewSource,
} from "./contracts.ts";

type Row = Record<string, SQLOutputValue>;
function text(row: Row, key: string): string {
	const value = row[key];
	if (typeof value !== "string")
		throw new Error(`Invalid board archive field: ${key}`);
	return value;
}
function count(row: Row, key: string): number {
	const value = row[key];
	if (typeof value !== "number" || !Number.isSafeInteger(value))
		throw new Error(`Invalid board archive count: ${key}`);
	return value;
}
function nullableText(row: Row, key: string): string | null {
	return row[key] === null ? null : text(row, key);
}
function post(row: Row): Post {
	return {
		id: text(row, "id"),
		channel: text(row, "channel"),
		author: text(row, "author"),
		createdAt: text(row, "created_at"),
		text: text(row, "text"),
	};
}

/** The archive is opened read-only; no migrations, board creation or subscriptions. */
export class Archive {
	private readonly db: DatabaseSync | undefined;
	private readonly source: ViewSource;
	constructor(source: ViewSource) {
		this.source = source;
		try {
			statSync(source.databasePath);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return;
			throw error;
		}
		const db = new DatabaseSync(source.databasePath, { readOnly: true });
		try {
			db.exec("PRAGMA busy_timeout=2000; PRAGMA query_only=ON; BEGIN");
			if (db.prepare("PRAGMA user_version").get()?.["user_version"] !== 1)
				throw new Error("Unsupported board archive version");
			this.db = db;
		} catch (error) {
			db.close();
			throw error;
		}
	}
	close(): void {
		this.db?.close();
	}
	private all(sql: string, ...args: SQLInputValue[]): Row[] {
		return this.db?.prepare(sql).all(...args) ?? [];
	}
	private hasTable(name: string): boolean {
		return (
			this.all(
				"SELECT name FROM sqlite_master WHERE type='table' AND name=?",
				name,
			).length > 0
		);
	}
	private status(id: string, threadId: string): ThreadStatus {
		if (!this.hasTable("thread_statuses")) return "open";
		const value = this.all(
			"SELECT status FROM thread_statuses WHERE board_id=? AND thread_id=?",
			id,
			threadId,
		)[0]?.["status"];
		return value === "completed" || value === "abandoned" ? value : "open";
	}
	private summary(id: string, threadId: string): DiscussionSummary | null {
		if (!this.hasTable("thread_summaries")) return null;
		const row = this.all(
			`SELECT s.*, EXISTS(SELECT 1 FROM posts p WHERE p.board_id=s.board_id AND p.root=s.thread_id
			AND p.seq>(SELECT seq FROM posts covered WHERE covered.board_id=s.board_id AND covered.id=s.through_message_id)) AS has_newer_posts
			FROM thread_summaries s WHERE s.board_id=? AND s.thread_id=?`,
			id,
			threadId,
		)[0];
		return row
			? {
					text: text(row, "text"),
					createdAt: text(row, "created_at"),
					throughMessageId: text(row, "through_message_id"),
					hasNewerPosts: count(row, "has_newer_posts") === 1,
					provider: text(row, "provider"),
					model: text(row, "model"),
					reasoning: text(row, "reasoning"),
				}
			: null;
	}

	index(): BoardIndex {
		const { databasePath: _path, ...context } = this.source;
		const boards: BoardSummary[] = this.all(
			`SELECT b.board_id,b.root_session_id,b.created_at,
			(SELECT MAX(created_at) FROM posts WHERE board_id=b.board_id) AS last_activity,
			(SELECT COUNT(*) FROM channels WHERE board_id=b.board_id) AS channels,
			(SELECT COUNT(*) FROM posts WHERE board_id=b.board_id) AS posts,
			(SELECT COUNT(DISTINCT author) FROM posts WHERE board_id=b.board_id) AS agents
			FROM boards b WHERE owner_folder=? ORDER BY COALESCE(last_activity,b.created_at) DESC`,
			this.source.folder,
		).map((row) => ({
			id: text(row, "board_id"),
			rootSessionId: text(row, "root_session_id"),
			createdAt: text(row, "created_at"),
			lastActivity: nullableText(row, "last_activity"),
			channels: count(row, "channels"),
			posts: count(row, "posts"),
			agents: count(row, "agents"),
		}));
		if (!boards.some((board) => board.id === context.boardId))
			boards.unshift({
				id: context.boardId,
				rootSessionId: context.sessionId,
				createdAt: null,
				lastActivity: null,
				channels: 0,
				posts: 0,
				agents: 0,
			});
		return { context, boards };
	}

	private board(id: string): BoardSummary {
		const board = this.index().boards.find((board) => board.id === id);
		if (!board) throw new Error("Board not found in this folder");
		return board;
	}

	detail(id: string): BoardDetail {
		const board = this.board(id);
		const channels = this.all(
			`SELECT c.name,c.author,c.created_at,COUNT(p.id) AS posts,
			COUNT(CASE WHEN p.id=p.root THEN 1 END) AS threads,MAX(p.created_at) AS last_activity
			FROM channels c LEFT JOIN posts p ON p.board_id=c.board_id AND p.channel=c.name
			WHERE c.board_id=? GROUP BY c.name ORDER BY COALESCE(last_activity,c.created_at) DESC,c.name`,
			id,
		).map((row) => ({
			name: text(row, "name"),
			author: text(row, "author"),
			createdAt: text(row, "created_at"),
			posts: count(row, "posts"),
			threads: count(row, "threads"),
			lastActivity: nullableText(row, "last_activity"),
		}));
		const agents = this.all(
			"SELECT author,COUNT(*) AS posts,MAX(created_at) AS last_activity FROM posts WHERE board_id=? GROUP BY author ORDER BY posts DESC,author",
			id,
		).map((row) => ({
			name: text(row, "author"),
			posts: count(row, "posts"),
			lastActivity: text(row, "last_activity"),
		}));
		const subscriptions = this.all(
			"SELECT target,agent,enabled FROM subscriptions WHERE board_id=? ORDER BY target,agent",
			id,
		).map((row) => ({
			target: text(row, "target"),
			agent: text(row, "agent"),
			enabled: count(row, "enabled") === 1,
		}));
		return { board, channels, agents, subscriptions };
	}

	threads(id: string, params: URLSearchParams): ThreadPage {
		this.board(id);
		const channel = params.get("channel");
		const query = params.get("q");
		const author = params.get("author");
		const summaries =
			this.hasTable("thread_summaries") && params.get("full") !== "true";
		if (query && query.length > 1000) throw new Error("Search is too long");
		const where = ["r.board_id=?", "r.id=r.root"];
		const args: SQLInputValue[] = [id];
		if (channel !== null) {
			where.push("r.channel=?");
			args.push(channel);
		}
		if (query || author) {
			const match = ["m.board_id=r.board_id", "m.root=r.id"];
			if (query) {
				match.push("instr(m.body_search,?)>0");
				args.push(caseFold(query));
			}
			if (author) {
				match.push("m.author=?");
				args.push(author);
			}
			const originals = `EXISTS(SELECT 1 FROM posts m WHERE ${match.join(" AND ")})`;
			if (summaries) {
				const summaryMatch = ["s.board_id=r.board_id", "s.thread_id=r.id"];
				if (query) {
					summaryMatch.push("instr(s.body_search,?)>0");
					args.push(caseFold(query));
				}
				if (author) {
					summaryMatch.push(
						"EXISTS(SELECT 1 FROM posts a WHERE a.board_id=r.board_id AND a.root=r.id AND a.author=?)",
					);
					args.push(author);
				}
				where.push(
					`((NOT EXISTS(SELECT 1 FROM thread_summaries s WHERE s.board_id=r.board_id AND s.thread_id=r.id) AND ${originals}) OR EXISTS(SELECT 1 FROM thread_summaries s WHERE ${summaryMatch.join(" AND ")}))`,
				);
			} else where.push(originals);
		}
		const cursor = this.cursor(params);
		const rows = this.all(
			`SELECT r.id,r.channel,r.author,r.text,r.created_at,
			MAX(p.created_at) AS last_activity,MAX(p.seq) AS last_seq,COUNT(*)-1 AS replies
			FROM posts r JOIN posts p ON p.board_id=r.board_id AND p.root=r.id
			WHERE ${where.join(" AND ")} GROUP BY r.id HAVING MAX(p.seq)<? ORDER BY last_seq DESC LIMIT 41`,
			...args,
			cursor ?? Number.MAX_SAFE_INTEGER,
		);
		const visible = rows.slice(0, 40);
		const last = visible.at(-1);
		return {
			threads: visible.map((row) => {
				const threadId = text(row, "id");
				const summary = this.summary(id, threadId);
				return {
					status: this.status(id, threadId),
					summarized: summary !== null,
					id: threadId,
					channel: text(row, "channel"),
					author: text(row, "author"),
					preview: (params.get("full") === "true"
						? text(row, "text")
						: (summary?.text ?? text(row, "text"))
					).slice(0, 600),
					createdAt: text(row, "created_at"),
					lastActivity: text(row, "last_activity"),
					replies: count(row, "replies"),
				};
			}),
			nextCursor:
				rows.length > 40 && last ? String(count(last, "last_seq")) : null,
		};
	}

	thread(id: string, threadId: string, params: URLSearchParams): ThreadDetail {
		this.board(id);
		const root = this.all(
			"SELECT id,channel,author,created_at,text FROM posts WHERE board_id=? AND id=? AND root=id",
			id,
			threadId,
		)[0];
		if (!root) throw new Error("Thread not found in this board");
		const summary = this.summary(id, threadId);
		const status = this.status(id, threadId);
		if (summary && params.get("full") !== "true")
			return { status, summary, root: null, replies: [], nextCursor: null };
		const rows = this.all(
			"SELECT seq,id,channel,author,created_at,text FROM posts WHERE board_id=? AND root=? AND id<>root AND seq>? ORDER BY seq LIMIT 81",
			id,
			threadId,
			this.cursor(params) ?? 0,
		);
		const visible = rows.slice(0, 80);
		const last = visible.at(-1);
		return {
			status,
			summary,
			root: post(root),
			replies: visible.map(post),
			nextCursor: rows.length > 80 && last ? String(count(last, "seq")) : null,
		};
	}

	private cursor(params: URLSearchParams): number | undefined {
		const value = params.get("cursor");
		if (value === null) return undefined;
		if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
			throw new Error("Invalid page cursor");
		return Number(value);
	}
}
