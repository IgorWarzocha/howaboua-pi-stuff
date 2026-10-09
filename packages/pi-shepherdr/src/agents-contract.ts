import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { Check } from "typebox/value";
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
	"answer",
] as const;
const BLOCKING_ACTIONS = new Set<string>(["spawn", "assign", "answer"]);
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
		"pane",
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
	answer: new Set(["action", "machine", "target", "ask_id", "answers"]),
};

const AskAnswerParameters = Type.Object(
	{
		selections: Type.Optional(Type.Array(Type.String())),
		other: Type.Optional(Type.String()),
		comment: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const AgentsRequest = Type.Object(
	{
		action: StringEnum(ACTIONS),
		commands: Type.Optional(Type.Literal(true)),
		machine: Type.Optional(Type.String()),
		voice: Type.Optional(Type.Boolean()),
		handoff: Type.Optional(Type.String()),
		target: Type.Optional(
			Type.String({ description: "Agent name or pane ID" }),
		),
		agent_type: Type.Optional(Type.String()),
		name: Type.Optional(
			Type.String({
				description: "Agent name; derived from label when omitted",
			}),
		),
		label: Type.Optional(Type.String()),
		placement: Type.Optional(StringEnum(START_PLACEMENTS)),
		workspace: Type.Optional(Type.String()),
		pane: Type.Optional(Type.String()),
		cwd: Type.Optional(Type.String()),
		message: Type.Optional(
			Type.String({ description: "Initial task or follow-up" }),
		),
		base: Type.Optional(Type.String({ description: "Review base branch" })),
		blocking: Type.Optional(
			Type.Boolean({
				description:
					"Delegation only; profile policy overrides spawn; otherwise defaults true",
			}),
		),
		context: Type.Optional(Type.Boolean()),
		board: Type.Optional(Type.Boolean()),
		board_thread_id: Type.Optional(Type.String({ minLength: 1 })),
		query: Type.Optional(Type.String()),
		status: Type.Optional(StringEnum(STATUSES)),
		source: Type.Optional(StringEnum(READ_SOURCES)),
		lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		ask_id: Type.Optional(Type.String()),
		answers: Type.Optional(Type.Array(AskAnswerParameters)),
	},
	{ additionalProperties: false },
);

export const AgentsParameters = Type.Object({
	action: Type.Optional(StringEnum(ACTIONS)),
	commands: Type.Optional(Type.Literal(true)),
	target: Type.Optional(Type.String()),
	machine: Type.Optional(Type.String()),
});

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
	if (
		(action === "attach" || action === "detach") &&
		(typeof request["context"] !== "boolean" ||
			typeof request["board"] !== "boolean" ||
			(!request["context"] && !request["board"]))
	)
		throw new Error(
			`${action} requires context and board booleans; enable at least one`,
		);
	const askId = request["ask_id"];
	if (action === "answer" && (typeof askId !== "string" || !askId.trim())) {
		throw new Error("ask_id is required for answer");
	}
	if (action === "answer" && !Array.isArray(request["answers"])) {
		throw new Error("answers is required for answer");
	}
	const unknown = Object.keys(request).filter(
		(key) => !ACTION_FIELDS[action as keyof typeof ACTION_FIELDS].has(key),
	);
	if (unknown.length > 0) {
		throw new Error(`unknown ${action} field(s): ${unknown.join(", ")}`);
	}
	if (!Check(AgentsRequest, request)) {
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
		return BLOCKING_ACTIONS.has(value.action) && value.blocking !== false;
	} catch {
		return false;
	}
}

export function shouldBlockAgentSpawn(
	profileBlocking: boolean | undefined,
	blocking: boolean | undefined,
): boolean {
	return profileBlocking ?? blocking ?? true;
}
