import {
	bool,
	compile,
	int,
	lit,
	obj,
	oneOf,
	opt,
	type Static,
	str,
} from "@earendil-works/pi-schema";
import { START_PLACEMENTS } from "./launch.js";
import { loadAgentProfileBlocking } from "./profiles.js";

const ACTIONS = [
	"help",
	"list",
	"find",
	"focus",
	"spawn",
	"watch",
	"unwatch",
	"send",
	"assign",
	"attach",
	"detach",
	"read",
	"reply",
] as const;
export const READ_SOURCES = ["latest", "visible", "recent"] as const;
const STATUSES = ["idle", "working", "blocked", "done", "unknown"] as const;

const ACTION_FIELDS: Record<(typeof ACTIONS)[number], ReadonlySet<string>> = {
	help: new Set(["action", "commands", "target", "machine"]),
	list: new Set(["action", "machine"]),
	find: new Set(["action", "machine", "query", "status"]),
	focus: new Set(["action", "machine", "target", "voice", "handoff"]),
	spawn: new Set([
		"action",
		"machine",
		"agent_type",
		"name",
		"label",
		"placement",
		"workspace",
		"cwd",
		"message",
		"base",
		"blocking",
		"board_thread_id",
	]),
	watch: new Set(["action", "machine", "target"]),
	unwatch: new Set(["action", "machine", "target"]),
	send: new Set(["action", "machine", "target", "message"]),
	assign: new Set(["action", "machine", "target", "message", "blocking"]),
	attach: new Set(["action", "machine", "target", "context", "board"]),
	detach: new Set(["action", "machine", "target", "context", "board"]),
	read: new Set(["action", "machine", "target", "source", "lines"]),
	reply: new Set(["action", "machine", "target", "extension", "id", "message"]),
};
const AgentsRequest = obj({
	action: {
		...oneOf(ACTIONS),
		type: "string",
	},
	commands: opt({
		...lit(true),
		type: "boolean",
	}),
	machine: opt(str()),
	voice: opt(bool()),
	handoff: opt(str()),
	target: opt(str()),
	agent_type: opt(str()),
	name: opt(
		str({
			description: "Agent name; derived from label when omitted",
		}),
	),
	label: opt(str()),
	placement: opt({
		...oneOf(START_PLACEMENTS),
		type: "string",
	}),
	workspace: opt(str()),
	cwd: opt(str()),
	message: opt(str({ description: "Task, follow-up or extension reply" })),
	base: opt(str({ description: "Review base branch" })),
	blocking: opt(
		bool({
			description:
				"Wait for delegated result; profile policy overrides spawn; default false",
		}),
	),
	context: opt(bool()),
	board: opt(bool()),
	board_thread_id: opt(str({ minLength: 1 })),
	query: opt(str()),
	status: opt({
		...oneOf(STATUSES),
		type: "string",
	}),
	source: opt({
		...oneOf(READ_SOURCES),
		type: "string",
	}),
	lines: opt(int({ minimum: 1, maximum: 200 })),
	extension: opt(str()),
	id: opt(str()),
});
const checkAgentsRequest = compile(AgentsRequest).check;
export const AgentsParameters = {
	...obj(
		{
			action: opt({
				...oneOf(ACTIONS),
				type: "string",
			}),
			commands: opt({
				...lit(true),
				type: "boolean",
			}),
			target: opt(str()),
			machine: opt(str()),
		},
		{ open: true },
	),
	additionalProperties: true,
};
export type AgentsParams = Static<typeof AgentsRequest>;
export type AgentsToolParams = Static<typeof AgentsParameters>;

export function requiredAgentField(
	value: string | undefined,
	field: string,
): string {
	if (!value?.trim()) throw new Error(`${field} is required for this action`);
	return value.trim();
}

export function parseAgentsRequest(input: unknown): AgentsParams {
	if (input === undefined) return { action: "help" };
	let value = input;
	if (typeof input === "string") {
		const text = input.trim();
		if (!text)
			throw new Error('agents request must be "help" or a JSON object');
		if (text === "help") return { action: "help" };
		try {
			value = JSON.parse(text);
		} catch (error) {
			throw new Error(
				`agents request must be "help" or valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("agents request must be a JSON object");
	}
	if (Object.keys(value).length === 0) return { action: "help" };
	let request = value as Record<string, unknown>;
	if (!("action" in request) && request["commands"] === true)
		request = { ...request, action: "help" };
	const action = request["action"];
	if (typeof action !== "string" || !Object.hasOwn(ACTION_FIELDS, action)) {
		throw new Error(`agents action must be one of: ${ACTIONS.join(", ")}`);
	}
	if (action === "send" && "blocking" in request) {
		throw new Error(
			"send is message-only; omit blocking. Use assign to delegate work",
		);
	}
	if ("commands" in request && action !== "help")
		throw new Error("commands requires action=help or no action");
	if (
		action === "help" &&
		request["commands"] !== true &&
		("target" in request || "machine" in request)
	)
		throw new Error("target and machine require commands:true for help");
	if (action === "help" && "machine" in request && !("target" in request))
		throw new Error(
			"machine requires target for command discovery; omit both for this session",
		);
	if (action === "attach" || action === "detach") {
		for (const field of ["context", "board"]) {
			if (field in request && typeof request[field] !== "boolean")
				throw new Error(`${field} must be a boolean`);
		}
		if (request["context"] !== true && request["board"] !== true)
			throw new Error(`${action} requires context:true or board:true`);
		request = { context: false, board: false, ...request };
	}
	if (action === "reply") {
		for (const field of ["extension", "id", "target"]) {
			if (typeof request[field] !== "string" || !request[field].trim())
				throw new Error(`${field} is required for reply`);
		}
		if (typeof request["message"] !== "string")
			throw new Error("message is required for reply");
	}
	const unknown = Object.keys(request).filter(
		(key) => !ACTION_FIELDS[action as keyof typeof ACTION_FIELDS].has(key),
	);
	if (unknown.length > 0) {
		throw new Error(`unknown ${action} field(s): ${unknown.join(", ")}`);
	}
	if (
		action === "read" &&
		"source" in request &&
		!READ_SOURCES.some((source) => source === request["source"])
	) {
		throw new Error(`read source must be one of: ${READ_SOURCES.join(", ")}`);
	}
	if (!checkAgentsRequest(request)) {
		throw new Error(
			`invalid ${action} request; call agents help for its contract`,
		);
	}
	return request as AgentsParams;
}

export function isBlockingAgentsCall(input: unknown): boolean {
	try {
		const value = parseAgentsRequest(input);
		if (value.action === "spawn")
			return shouldBlockAgentSpawn(
				loadAgentProfileBlocking(
					requiredAgentField(value.agent_type, "agent_type"),
				),
				value.blocking,
			);
		return value.action === "assign" && value.blocking === true;
	} catch {
		return false;
	}
}

export function shouldBlockAgentSpawn(
	profileBlocking: boolean | undefined,
	blocking: boolean | undefined,
): boolean {
	return profileBlocking ?? blocking ?? false;
}
