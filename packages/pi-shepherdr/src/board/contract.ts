import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { Check } from "typebox/value";

const BOARD_ACTIONS = [
	"help",
	"list_boards",
	"create_channel",
	"get_channels",
	"post",
	"list_threads",
	"read_thread",
	"read_post",
	"search_posts",
	"subscribe",
	"unsubscribe",
] as const;
export const BoardParameters = Type.Object({
	action: StringEnum(BOARD_ACTIONS),
});
const positive = Type.Optional(
	Type.Integer({ minimum: 1, maximum: 0xffffffff }),
);
const string = Type.Optional(Type.String());
const Request = Type.Object(
	{
		action: StringEnum(BOARD_ACTIONS),
		channel_name: string,
		new_channel_name: string,
		thread_id: string,
		message_id: string,
		text: string,
		query: string,
		author: string,
		target_agent: string,
		after_message_id: string,
		board_id: string,
		cursor: string,
		subscribe: Type.Optional(Type.Boolean()),
		recent_first: Type.Optional(Type.Boolean()),
		sort: Type.Optional(StringEnum(["created", "activity"])),
		limit: positive,
		max_chars_per_post: positive,
		limit_chars: positive,
		offset_chars: Type.Optional(
			Type.Integer({ minimum: 0, maximum: 0xffffffff }),
		),
		agents_to_notify: Type.Optional(
			Type.Array(Type.String(), { maxItems: 256 }),
		),
	},
	{ additionalProperties: false },
);
export type BoardParams = Static<typeof Request>;
export type BoardAction = BoardParams["action"];
export const MUTATIONS = new Set<BoardAction>([
	"create_channel",
	"post",
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
	list_threads: [
		"channel_name",
		"sort",
		"recent_first",
		"max_chars_per_post",
		...paging,
		...reads,
	],
	read_thread: ["thread_id", "max_chars_per_post", ...paging, ...reads],
	read_post: ["message_id", "offset_chars", "limit_chars", ...reads],
	search_posts: [
		"channel_name",
		"query",
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
	list_threads: ["channel_name"],
	read_thread: ["thread_id"],
	read_post: ["message_id"],
};
export function parseBoardRequest(value: unknown): BoardParams {
	if (!Check(Request, value))
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
		"board_id",
	] as const) {
		const id = request[field];
		if (
			id !== undefined &&
			!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
				id,
			)
		)
			throw new Error(`${field} must be a UUID`);
		if (id !== undefined) request[field] = id.toLowerCase();
	}
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
	if (!/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(path))
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
						`${field}${requiredFields[action as BoardAction]?.includes(field) ? "" : "?"}`,
				)
				.join(" "),
		]),
	),
	rules: {
		scope:
			"Defaults to your tree; board_id browses history, never writes. list_boards discovers saved boards",
		post: "text required; exactly one of channel_name, new_channel_name, thread_id. Thread ID is the first post ID. New channel subscribes author to first posts",
		subscriptions:
			"Exactly one of channel_name/thread_id; channel covers first posts, thread covers replies. target_agent defaults to you. Posting subscribes author to thread unless explicitly unsubscribed",
		notify:
			"agents_to_notify is one-time, excludes author; only running turns, no waking or offline notices",
		agents:
			"Use spawn's boardAgent; absolute /root/... or child path relative to you, not a pane or contextAgent",
		paging:
			"limit default20, cap50; cursor opaque, keep query/sort unchanged. Concurrent posts may shift pages",
		order:
			"Newest first; get_channels by activity, list_threads sort=created|activity. read_thread pages newest replies with root on every page",
		text: "Case-insensitive substring search; max_chars_per_post default1000. read_post offsets count Unicode characters, limit_chars default20000. Continue at next_offset_chars<n_chars",
		budget:
			"Post cap64KiB, channel1-128 UTF-8 bytes without edge whitespace/control characters. Results cap8000 serialized UTF-8 bytes; reads may reduce limits, continue with returned cursor/offset",
	},
};
