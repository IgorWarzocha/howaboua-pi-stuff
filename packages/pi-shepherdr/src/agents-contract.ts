import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import { START_PLACEMENTS } from "./launch.js";

const ACTIONS = [
	"help",
	"list",
	"find",
	"start",
	"watch",
	"unwatch",
	"send",
	"read",
	"answer",
] as const;
const BLOCKING_ACTIONS = new Set<string>(["start", "send", "answer"]);
export const READ_SOURCES = ["latest", "visible", "recent"] as const;
const STATUSES = ["idle", "working", "blocked", "done", "unknown"] as const;

const ACTION_FIELDS: Record<(typeof ACTIONS)[number], ReadonlySet<string>> = {
	help: new Set(["action"]),
	list: new Set(["action", "machine"]),
	find: new Set(["action", "machine", "query", "status"]),
	start: new Set([
		"action",
		"machine",
		"profile",
		"name",
		"label",
		"placement",
		"workspace",
		"pane",
		"cwd",
		"message",
		"base",
		"blocking",
	]),
	watch: new Set(["action", "machine", "target"]),
	unwatch: new Set(["action", "machine", "target"]),
	send: new Set(["action", "machine", "target", "message", "blocking"]),
	read: new Set(["action", "machine", "target", "source", "lines"]),
	answer: new Set(["action", "machine", "target", "answers", "blocking"]),
};

const AskAnswerParameters = Type.Object({
	selections: Type.Optional(Type.Array(Type.String())),
	other: Type.Optional(Type.String()),
	comment: Type.Optional(Type.String()),
});

const AgentsRequest = Type.Object(
	{
		action: StringEnum(ACTIONS),
		machine: Type.Optional(
			Type.String({ description: "Configured machine; defaults to local" }),
		),
		target: Type.Optional(
			Type.String({ description: "Agent name or pane ID" }),
		),
		profile: Type.Optional(Type.String()),
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
		base: Type.Optional(Type.String({ description: "Reviewer base branch" })),
		blocking: Type.Optional(
			Type.Boolean({
				description:
					"Wait for this work; defaults true. False returns now and pushes settlement later",
			}),
		),
		query: Type.Optional(Type.String()),
		status: Type.Optional(StringEnum(STATUSES)),
		source: Type.Optional(StringEnum(READ_SOURCES)),
		lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		answers: Type.Optional(Type.Array(AskAnswerParameters)),
	},
	{ additionalProperties: false },
);

export const AgentsParameters = Type.Object({ action: StringEnum(ACTIONS) });

export type AgentsParams = Static<typeof AgentsRequest>;
export type AgentsToolParams = Static<typeof AgentsParameters>;

export function parseAgentsRequest(input: unknown): AgentsParams {
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
	const action = "action" in value ? value.action : undefined;
	if (typeof action !== "string" || !Object.hasOwn(ACTION_FIELDS, action)) {
		throw new Error(`agents action must be one of: ${ACTIONS.join(", ")}`);
	}
	const unknown = Object.keys(value).filter(
		(key) => !ACTION_FIELDS[action as keyof typeof ACTION_FIELDS].has(key),
	);
	if (unknown.length > 0) {
		throw new Error(`unknown ${action} field(s): ${unknown.join(", ")}`);
	}
	if (!Check(AgentsRequest, value)) {
		throw new Error(
			`invalid ${action} request; call agents help for its contract`,
		);
	}
	return value as AgentsParams;
}

export function isBlockingAgentsCall(input: unknown): boolean {
	try {
		const value = parseAgentsRequest(input);
		return BLOCKING_ACTIONS.has(value.action) && value.blocking !== false;
	} catch {
		return false;
	}
}
