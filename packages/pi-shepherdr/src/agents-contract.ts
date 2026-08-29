import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { START_PLACEMENTS } from "./launch.js";

const ACTIONS = [
	"list",
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

const AskAnswerParameters = Type.Object({
	selections: Type.Optional(Type.Array(Type.String())),
	other: Type.Optional(Type.String()),
	comment: Type.Optional(Type.String()),
});

export const AgentsParameters = Type.Object({
	action: StringEnum(ACTIONS),
	machine: Type.Optional(
		Type.String({ description: "Configured machine; defaults to local" }),
	),
	target: Type.Optional(Type.String({ description: "Agent name or pane ID" })),
	profile: Type.Optional(Type.String()),
	name: Type.Optional(
		Type.String({ description: "Agent name; derived from label when omitted" }),
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
});

export type AgentsParams = Static<typeof AgentsParameters>;

export function isBlockingAgentsCall(input: unknown): boolean {
	if (typeof input !== "object" || input === null || !("action" in input)) {
		return false;
	}
	const value = input as { action?: unknown; blocking?: unknown };
	return (
		typeof value.action === "string" &&
		BLOCKING_ACTIONS.has(value.action) &&
		value.blocking !== false
	);
}
