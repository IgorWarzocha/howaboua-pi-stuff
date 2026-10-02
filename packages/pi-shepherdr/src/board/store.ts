import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { caseFold } from "unicode-case-folding";
import {
	agentPath,
	type BoardParams,
	MUTATIONS,
	required,
} from "./contract.js";
import { metadata, POST_COLUMNS, type PostRecord, preview } from "./paging.js";
import { queryBoard } from "./queries.js";
import { serializeBoardResult } from "./response.js";

export interface BoardScope {
	boardId: string;
	rootSessionId: string;
	ownerFolder: string;
	agentName: string;
	callerSessionId: string;
	members: readonly string[];
}
const SCHEMA = `
CREATE TABLE boards (board_id TEXT PRIMARY KEY, root_session_id TEXT NOT NULL, owner_folder TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE channels (board_id TEXT NOT NULL, name TEXT NOT NULL, name_search TEXT NOT NULL, created_at TEXT NOT NULL, author TEXT NOT NULL, PRIMARY KEY(board_id,name));
CREATE TABLE posts (seq INTEGER PRIMARY KEY AUTOINCREMENT,board_id TEXT NOT NULL,id TEXT NOT NULL,channel TEXT NOT NULL,root TEXT NOT NULL,author TEXT NOT NULL,created_at TEXT NOT NULL,text TEXT NOT NULL,body_search TEXT NOT NULL,request_id TEXT NOT NULL,request TEXT NOT NULL,UNIQUE(board_id,id),UNIQUE(board_id,request_id));
CREATE INDEX posts_channel ON posts(board_id,channel,created_at,seq);
CREATE INDEX posts_root ON posts(board_id,root,created_at,seq);
CREATE INDEX posts_order ON posts(board_id,created_at,seq);
CREATE TABLE subscriptions (board_id TEXT NOT NULL,target TEXT NOT NULL,agent TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(board_id,target,agent));
PRAGMA user_version=1;`;

/** One transaction/connection per call. Reads never create a file, schema or board. */
export class BoardStore {
	readonly db: DatabaseSync;
	constructor(path: string, write: boolean) {
		const fresh = !existsSync(path);
		if (write && fresh) mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path, { readOnly: !write });
		try {
			this.db.exec("PRAGMA busy_timeout=5000");
			if (write) {
				if (fresh) chmodSync(path, 0o600);
				this.db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE");
			}
			const version = this.one<{ user_version: number }>(
				"PRAGMA user_version",
			)?.user_version;
			if (
				version === 0 &&
				write &&
				this.all("SELECT name FROM sqlite_master WHERE type='table'").length ===
					0
			)
				this.db.exec(SCHEMA);
			else if (version !== 1)
				throw new Error("Unsupported Shepherdr board archive schema");
			if (write) this.db.exec("COMMIT");
		} catch (error) {
			this.db.close();
			throw error;
		}
	}
	one<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
		return this.db.prepare(sql).get(...args) as T | undefined;
	}
	all<T>(sql: string, ...args: SQLInputValue[]): T[] {
		return this.db.prepare(sql).all(...args) as T[];
	}
	run(sql: string, ...args: SQLInputValue[]) {
		return this.db.prepare(sql).run(...args);
	}
	post(board: string, id: string): PostRecord {
		const post = this.one<PostRecord>(
			`SELECT ${POST_COLUMNS} FROM posts WHERE board_id=? AND id=?`,
			board,
			id,
		);
		if (!post) throw new Error("Post not found in this board");
		return post;
	}
	root(board: string, id: string): PostRecord {
		const post = this.post(board, id);
		if (post.thread_id !== id)
			throw new Error("thread_id must identify a first post");
		return post;
	}
	channel(board: string, name: string) {
		const channel = this.one<{
			channel_name: string;
			created_at: string;
			created_by: string;
			message_count: number;
			last_message_id: string | null;
		}>(
			`SELECT name AS channel_name,created_at,author AS created_by,
		(SELECT COUNT(*) FROM posts p WHERE p.board_id=c.board_id AND p.channel=c.name) AS message_count,
		(SELECT id FROM posts p WHERE p.board_id=c.board_id AND p.channel=c.name ORDER BY created_at DESC,seq DESC LIMIT 1) AS last_message_id
		FROM channels c WHERE board_id=? AND name=?`,
			board,
			name,
		);
		if (!channel) throw new Error("Channel not found in this board");
		return channel;
	}
	execute(scope: BoardScope, params: BoardParams, requestId: string) {
		const write = MUTATIONS.has(params.action);
		this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
		try {
			const result = write
				? this.mutate(scope, params, requestId)
				: { value: queryBoard(this, scope.boardId, params), recipients: [] };
			if (write) serializeBoardResult(result.value);
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	close() {
		this.db.close();
	}
	private ensureBoard(scope: BoardScope, now: string) {
		this.run(
			"INSERT OR IGNORE INTO boards VALUES(?,?,?,?)",
			scope.boardId,
			scope.rootSessionId,
			scope.ownerFolder,
			now,
		);
	}
	private insertChannel(scope: BoardScope, name: string, now: string) {
		if (
			this.one(
				"SELECT 1 FROM channels WHERE board_id=? AND name=?",
				scope.boardId,
				name,
			)
		)
			throw new Error("Channel already exists");
		this.run(
			"INSERT INTO channels VALUES(?,?,?,?,?)",
			scope.boardId,
			name,
			caseFold(name),
			now,
			scope.agentName,
		);
	}
	private subscription(
		board: string,
		target: string,
		agent: string,
		enabled: boolean,
		implicit = false,
	) {
		this.run(
			implicit
				? "INSERT OR IGNORE INTO subscriptions VALUES(?,?,?,1)"
				: "INSERT INTO subscriptions VALUES(?,?,?,?) ON CONFLICT(board_id,target,agent) DO UPDATE SET enabled=excluded.enabled",
			...[board, target, agent, ...(implicit ? [] : [enabled ? 1 : 0])],
		);
	}
	private resolve(scope: BoardScope, value: string) {
		const path = agentPath(value, scope.agentName);
		if (!scope.members.includes(path))
			throw new Error(`Agent not bound to this tree: ${path}`);
		return path;
	}
	private mutate(scope: BoardScope, params: BoardParams, requestId: string) {
		const board = scope.boardId;
		if (params.action === "post") return this.publish(scope, params, requestId);
		if (params.action === "create_channel") {
			const name = required(params.channel_name, "channel_name");
			const now = new Date().toISOString();
			this.ensureBoard(scope, now);
			this.insertChannel(scope, name, now);
			if (params.subscribe !== false)
				this.subscription(board, `channel:${name}`, scope.agentName, true);
			return { value: this.channel(board, name), recipients: [] };
		}
		const target_agent =
			params.target_agent === undefined
				? scope.agentName
				: this.resolve(scope, params.target_agent);
		const root =
			params.thread_id === undefined
				? undefined
				: this.root(board, params.thread_id);
		const channel = this.channel(
			board,
			root?.channel_name ?? required(params.channel_name, "channel_name"),
		);
		const thread_id = root?.thread_id ?? null;
		const target = root
			? `thread:${root.thread_id}`
			: `channel:${channel.channel_name}`;
		const last = root
			? (this.one<{ id: string }>(
					"SELECT id FROM posts WHERE board_id=? AND root=? ORDER BY created_at DESC,seq DESC LIMIT 1",
					board,
					root.thread_id,
				)?.id ?? null)
			: channel.last_message_id;
		const enabled = params.action === "subscribe";
		this.subscription(board, target, target_agent, enabled);
		return {
			value: {
				channel_name: channel.channel_name,
				thread_id,
				target_agent,
				enabled,
				last_message_id: last,
			},
			recipients: [],
		};
	}
	private publish(scope: BoardScope, params: BoardParams, requestId: string) {
		const board = scope.boardId;
		const request = JSON.stringify(
			Object.fromEntries(
				Object.entries({
					...params,
					agents_to_notify: params.agents_to_notify ?? [],
				}).sort(([a], [b]) => a.localeCompare(b)),
			),
		);
		const key = `${scope.callerSessionId}:${requestId}`;
		if (!requestId || Buffer.byteLength(key) > 1024)
			throw new Error("Invalid post invocation ID");
		const previous = this.one<{ id: string; request: string }>(
			"SELECT id,request FROM posts WHERE board_id=? AND request_id=?",
			board,
			key,
		);
		if (previous) {
			if (previous.request !== request)
				throw new Error("Invocation ID already used for a different post");
			return { value: metadata(this.post(board, previous.id)), recipients: [] };
		}
		const recipients = new Set(
			(params.agents_to_notify ?? []).map((name) => this.resolve(scope, name)),
		);
		const now = new Date().toISOString();
		const id = randomUUID();
		let channel: string;
		let root: string = id;
		if (params.thread_id !== undefined) {
			const post = this.root(board, params.thread_id);
			channel = post.channel_name;
			root = post.thread_id;
		} else if (params.new_channel_name !== undefined) {
			channel = params.new_channel_name;
			this.ensureBoard(scope, now);
			this.insertChannel(scope, channel, now);
			this.subscription(board, `channel:${channel}`, scope.agentName, true);
		} else
			channel = this.channel(
				board,
				required(params.channel_name, "channel_name"),
			).channel_name;
		const target = root === id ? `channel:${channel}` : `thread:${root}`;
		for (const { agent } of this.all<{ agent: string }>(
			"SELECT agent FROM subscriptions WHERE board_id=? AND target=? AND enabled=1",
			board,
			target,
		))
			recipients.add(agent);
		recipients.delete(scope.agentName);
		const post: PostRecord = {
			message_id: id,
			channel_name: channel,
			author: scope.agentName,
			thread_id: root,
			created_at: now,
			text: required(params.text, "text"),
		};
		this.run(
			"INSERT INTO posts(board_id,id,channel,root,author,created_at,text,body_search,request_id,request) VALUES(?,?,?,?,?,?,?,?,?,?)",
			board,
			id,
			channel,
			root,
			scope.agentName,
			now,
			post.text,
			caseFold(post.text),
			key,
			request,
		);
		this.subscription(board, `thread:${root}`, scope.agentName, true, true);
		return {
			value: metadata(post),
			notice: preview(post, 150),
			recipients: [...recipients],
		};
	}
}

export function validateMutation(params: BoardParams) {
	if (
		params.action === "create_channel" ||
		params.new_channel_name !== undefined
	) {
		const name = required(
			params.new_channel_name ?? params.channel_name,
			"channel_name",
		);
		if (
			!name ||
			!name.isWellFormed() ||
			Buffer.byteLength(name) > 128 ||
			name.trim() !== name ||
			/\p{Cc}/u.test(name)
		)
			throw new Error(
				"Channel must be 1-128 UTF-8 bytes without edge whitespace/control characters",
			);
	}
	if (params.action === "post") {
		const text = required(params.text, "text");
		if (!text || !text.isWellFormed() || Buffer.byteLength(text) > 65536)
			throw new Error("Post must be 1-65536 UTF-8 bytes");
	}
}
