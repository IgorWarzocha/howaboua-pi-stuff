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
const REPLY_ALIAS = { input: "reply", canonical: "post" } as const;
const THREAD_STATUSES = ["open", "completed", "abandoned"] as const;
const THREAD_SORTS = ["created", "activity"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export const BoardParameters = obj(
	{
		action: opt({ ...oneOf(BOARD_ACTIONS), type: "string" }),
	},
	{ open: true },
);
// Nested callers type-check the supplied action; Pi validates the canonical request.
export const BoardNestedParameters = obj(
	{
		action: opt({
			...oneOf([...BOARD_ACTIONS, REPLY_ALIAS.input]),
			type: "string",
		}),
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
		sort: opt({ ...oneOf(THREAD_SORTS), type: "string" }),
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

function normalizeBoardAction(value: unknown): unknown {
	if (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"action" in value &&
		value.action === REPLY_ALIAS.input
	) {
		if (!("thread_id" in value) || value.thread_id === undefined)
			throw new Error("thread_id is required for a reply");
		return { ...value, action: REPLY_ALIAS.canonical };
	}
	return value;
}

export function parseBoardRequest(value: unknown): BoardParams {
	value = normalizeBoardAction(value);
	if (value === undefined) return { action: "help" };
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected a board action object. Use {} for help.");
	const keys = Object.keys(value);
	if (!keys.length) return { action: "help" };
	if (!("action" in value))
		throw new Error("Missing board action. Use {} for help.");
	const inputAction = value.action;
	if (typeof inputAction !== "string")
		throw new Error("Board action must be a string. Use {} for help.");
	const action = BOARD_ACTIONS.find((candidate) => candidate === inputAction);
	if (!action)
		throw new Error(
			`Unknown board action ${JSON.stringify(inputAction)}. Use {} for help.`,
		);
	const unexpected = keys.find(
		(field) => field !== "action" && !fields[action].includes(field),
	);
	if (unexpected === "board_id" && MUTATIONS.has(action))
		throw new Error(
			`${action} does not accept board_id. It is for reads only.`,
		);
	if (unexpected !== undefined)
		throw new Error(
			`${action} does not accept ${JSON.stringify(unexpected)}. Use {} for help.`,
		);
	const validated = requestValidator.validate(value);
	if (!validated.ok) {
		const issue = validated.errors[0];
		throw new Error(
			issue
				? `${action} ${issue.path.slice(1)}: ${issue.message}`
				: `Invalid ${action} arguments. Use {} for help.`,
		);
	}
	const request = { ...validated.value };
	for (const field of requiredFields[request.action] ?? []) {
		if (!(field in request))
			throw new Error(`${request.action} requires ${field}`);
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
					? "Copy the full thread_id from list_threads on the same board and channel."
					: `${field} must be a full UUID`,
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
const fieldChoices: Record<string, readonly string[]> = {
	status: THREAD_STATUSES,
	sort: THREAD_SORTS,
};
export const boardHelp = {
	actions: Object.fromEntries(
		Object.entries(fields).map(([action, values]) => [
			action,
			values
				.map((field) => {
					const choices = fieldChoices[field];
					const name = choices ? `${field}=${choices.join("|")}` : field;
					return `${name}${requiredFields[action as BoardAction]?.includes(field) ? "" : "?"}`;
				})
				.join(" "),
		]),
	),
	rules: {
		scope: "Defaults to your tree. list_boards → board_id for reads only",
		post: "Exactly one: channel_name, new_channel_name or thread_id. Reply → copy full thread_id from list_threads",
		set_status:
			"Parent only. completed → user confirms done. abandoned → user drops it. Reopen before replying",
		subscriptions:
			"Choose channel_name for new threads or thread_id for replies. Default target: you. Posting subscribes you to the thread unless you opted out",
		notify:
			"Agent refs: /<Pi session ID>. agents_to_notify sends one-time notices to active agents",
		originals:
			"Saved summary → full=true for originals. Truncated preview → read_post",
		paging:
			"Repeat the same read with next_cursor as cursor. For read_post, use next_offset_chars as offset_chars while below n_chars",
	},
};
