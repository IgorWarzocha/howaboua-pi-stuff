import {
	arr,
	bool,
	compile,
	int,
	obj,
	oneOf,
	opt,
	type Static,
	str,
} from "@earendil-works/pi-schema";

const BOARD_ACTIONS = [
	"help",
	"list_boards",
	"create_channel",
	"get_channels",
	"post",
	"set_status",
	"list_threads",
	"read_thread",
	"read_post",
	"search_posts",
	"subscribe",
	"unsubscribe",
] as const;
const THREAD_STATUSES = ["open", "completed", "abandoned"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export const BoardParameters = obj(
	{
		action: opt({ ...oneOf(BOARD_ACTIONS), type: "string" }),
	},
	{ open: true },
);
const positive = opt(int({ minimum: 1, maximum: 0xffffffff }));
const string = opt(str());
const Request = obj(
	{
		action: { ...oneOf(BOARD_ACTIONS), type: "string" },
		channel_name: string,
		new_channel_name: string,
		thread_id: string,
		message_id: string,
		text: string,
		status: opt({ ...oneOf(THREAD_STATUSES), type: "string" }),
		comment: string,
		query: string,
		author: string,
		target_agent: string,
		after_message_id: string,
		board_id: string,
		cursor: string,
		full: opt(bool()),
		subscribe: opt(bool()),
		recent_first: opt(bool()),
		sort: opt({ ...oneOf(["created", "activity"]), type: "string" }),
		limit: positive,
		max_chars_per_post: positive,
		limit_chars: positive,
		offset_chars: opt(int({ minimum: 0, maximum: 0xffffffff })),
		agents_to_notify: opt(arr(str(), { maxItems: 256 })),
	},
	{ open: false },
);
export type BoardParams = Static<typeof Request>;
export type BoardAction = BoardParams["action"];
export const MUTATIONS = new Set<BoardAction>([
	"create_channel",
	"post",
	"set_status",
	"subscribe",
	"unsubscribe",
]);
const paging = ["limit", "cursor"];
const reads = ["board_id"];
const fields: Record<BoardAction, string[]> = {
	help: [],
	list_boards: paging,
	create_channel: ["channel_name", "subscribe"],
	get_channels: ["query", "recent_first", ...paging, ...reads],
	post: [
		"text",
		"channel_name",
		"new_channel_name",
		"thread_id",
		"agents_to_notify",
	],
	set_status: ["thread_id", "status", "comment"],
	list_threads: [
		"channel_name",
		"sort",
		"recent_first",
		"max_chars_per_post",
		...paging,
		...reads,
	],
	read_thread: ["thread_id", "full", "max_chars_per_post", ...paging, ...reads],
	read_post: ["message_id", "offset_chars", "limit_chars", ...reads],
	search_posts: [
		"channel_name",
		"query",
		"full",
		"author",
		"after_message_id",
		"max_chars_per_post",
		...paging,
		...reads,
	],
	subscribe: ["channel_name", "thread_id", "target_agent"],
	unsubscribe: ["channel_name", "thread_id", "target_agent"],
};
const requiredFields: Partial<Record<BoardAction, string[]>> = {
	create_channel: ["channel_name"],
	post: ["text"],
	set_status: ["thread_id", "status", "comment"],
	list_threads: ["channel_name"],
	read_thread: ["thread_id"],
	read_post: ["message_id"],
};
const requestValidator = compile(Request);

export function prepareBoardArguments(value: unknown): unknown {
	if (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"action" in value &&
		value.action === "reply"
	) {
		if (!("thread_id" in value) || value.thread_id === undefined)
			throw new Error("thread_id is required for a reply");
		return { ...value, action: "post" };
	}
	return value;
}

export function parseBoardRequest(value: unknown): BoardParams {
	value = prepareBoardArguments(value);
	if (
		value === undefined ||
		(typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			Object.keys(value).length === 0)
	)
		return { action: "help" };
	if (!requestValidator.check(value))
		throw new Error("Invalid board request; call board help");
	const request = { ...(value as BoardParams) };
	const allowed = new Set(["action", ...fields[request.action]]);
	if (Object.keys(request).some((field) => !allowed.has(field)))
		throw new Error(`Unknown ${request.action} field; board_id is read-only`);
	for (const field of requiredFields[request.action] ?? []) {
		if (!(field in request)) throw new Error(`${field} is required`);
	}
	for (const field of [
		"thread_id",
		"message_id",
		"after_message_id",
	] as const) {
		const id = request[field];
		if (
			id !== undefined &&
			!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
				id,
			)
		)
			throw new Error(
				field === "thread_id"
					? "thread_id must be a full UUID. Use list_threads on the same board and channel and copy thread_id."
					: `${field} must be a UUID`,
			);
		if (id !== undefined) request[field] = id.toLowerCase();
	}
	if (
		request.board_id !== undefined &&
		!/^[a-zA-Z0-9_.-]+$/.test(request.board_id)
	)
		throw new Error("Invalid board_id");
	if (request.action === "post")
		exactlyOne(request, ["channel_name", "new_channel_name", "thread_id"]);
	if (request.action === "subscribe" || request.action === "unsubscribe")
		exactlyOne(request, ["channel_name", "thread_id"]);
	return request;
}
function exactlyOne(value: BoardParams, keys: (keyof BoardParams)[]) {
	if (keys.filter((key) => value[key] !== undefined).length !== 1)
		throw new Error(`Provide exactly one of ${keys.join(", ")}`);
}
export function required(value: string | undefined, field: string): string {
	if (value === undefined) throw new Error(`${field} is required`);
	return value;
}
export function agentPath(value: string, caller: string): string {
	const path = value.startsWith("/") ? value : `${caller}/${value}`;
	if (!/^\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path))
		throw new Error("Invalid agent path");
	return path;
}
export const boardHelp = {
	actions: Object.fromEntries(
		Object.entries(fields).map(([action, values]) => [
			action,
			values
				.map(
					(field) =>
						`${field === "status" ? `status=${THREAD_STATUSES.join("|")}` : field}${requiredFields[action as BoardAction]?.includes(field) ? "" : "?"}`,
				)
				.join(" "),
		]),
	),
	rules: {
		scope:
			"Defaults to your tree; use list_boards to find a read-only board_id",
		post: "Choose exactly one of channel_name, new_channel_name, thread_id. A reply MUST use the full first post ID (thread_id from list_threads). New channel subscribes author to first posts",
		set_status:
			"The parent session alone sets status: completed when the user confirms it's done, abandoned when they drop it. Reopen closed threads before replying",
		subscriptions:
			"Exactly one of channel_name/thread_id; channel covers first posts, thread covers replies. target_agent defaults to you. Posting subscribes author to thread unless explicitly unsubscribed",
		notify:
			"agents_to_notify sends a one-time notice to other agents on running turns",
		agents:
			"Agent reference /<Pi session ID>; saved legacy references remain valid",
		paging:
			"limit defaults to 20, max 50. Reuse returned cursors with unchanged query, sort and full. Concurrent changes may shift pages",
		summaries:
			"If enabled, closing can trigger summarization. Reads and searches default to any saved summary; full=true uses original posts. Summary author filters match participants; read_post always reads originals",
		order:
			"Newest first; get_channels by activity, list_threads sort=created|activity. read_thread repeats the root on each page of replies",
		text: "Case-insensitive substring search; max_chars_per_post default1000. read_post offsets count Unicode characters, limit_chars default20000. Continue at next_offset_chars<n_chars",
		budget:
			"Posts max 64 KiB; channel names 1-128 UTF-8 bytes with no edge whitespace or control characters. Results max 8000 serialized UTF-8 bytes. Reads can lower limits; continue with returned cursor or offset",
	},
};

// Select only owned guidance. Routing metadata and adapter-provided prose stay intact.
export function gptBoardHelp(value: unknown): unknown {
	if (
		!value ||
		typeof value !== "object" ||
		!("rules" in value) ||
		!value.rules ||
		typeof value.rules !== "object"
	)
		return value;
	const compact: typeof boardHelp.rules = {
		scope: "Default=your tree; list_boards→read-only board_id",
		post: "Exactly one: channel_name|new_channel_name|thread_id. Reply MUST use full first post ID (list_threads→thread_id). New channel→subscribe author to first posts",
		set_status:
			"Parent session only; completed=user confirms done; abandoned=user drops it. Closed→reopen before reply",
		subscriptions:
			"Exactly one: channel_name|thread_id; channel=first posts, thread=replies; target_agent defaults to you; post→subscribe author unless explicitly unsubscribed",
		notify: "agents_to_notify→one-time notice to other agents on running turns",
		agents: "Agent=/<Pi session ID>; legacy references accepted",
		paging:
			"limit default 20 max 50; reuse cursor with unchanged query/sort/full; concurrent edits can shift pages",
		summaries:
			"Close can trigger summary if enabled; read/search default to saved summary; full=true→originals; summary author filters=participants; read_post→originals",
		order:
			"Newest first; get_channels by activity; list_threads sort=created|activity; read_thread repeats root each page",
		text: "Case-insensitive substring; max_chars_per_post default1000; read_post→Unicode-char offsets, limit_chars default20000; next_offset_chars<n_chars→continue",
		budget:
			"Post max 64 KiB; channel 1-128 UTF-8 bytes without edge whitespace/control chars. Result max 8000 serialized UTF-8 bytes. Reads can lower limits; continue at returned cursor/offset",
	};
	return {
		...value,
		rules: Object.fromEntries(
			Object.entries(value.rules).map(([key, text]) => [
				key,
				text === boardHelp.rules[key as keyof typeof compact]
					? compact[key as keyof typeof compact]
					: text,
			]),
		),
	};
}
