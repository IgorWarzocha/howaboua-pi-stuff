import { Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import { BindingSchema } from "./identity.js";

const NoticeSchema = Type.Object(
	{
		message_id: Type.String(),
		channel_name: Type.String(),
		author: Type.String(),
		thread_id: Type.String(),
		created_at: Type.String(),
		text_preview: Type.String({ maxLength: 300 }),
		n_chars: Type.Integer({ minimum: 0 }),
		truncated: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const Protocol = Type.Union([
	Type.Object({
		operation: Type.Literal("board-bind"),
		binding: BindingSchema,
	}),
	Type.Object({
		operation: Type.Literal("board-register"),
		caller: BindingSchema,
		member: BindingSchema,
	}),
	Type.Object({
		operation: Type.Literal("board-enabled"),
		boardId: Type.String(),
		enabled: Type.Boolean(),
	}),
	Type.Object({
		operation: Type.Literal("board-active"),
		caller: BindingSchema,
		turnId: Type.Union([Type.String(), Type.Null()]),
		previousTurnId: Type.Optional(Type.String()),
	}),
	Type.Object({
		operation: Type.Literal("board-call"),
		caller: BindingSchema,
		params: Type.Unknown(),
		requestId: Type.String(),
	}),
	Type.Object({
		operation: Type.Literal("board-notify"),
		boardId: Type.String(),
		target: Type.String(),
		sessionId: Type.String(),
		turnId: Type.String(),
		notice: NoticeSchema,
	}),
]);
export type BoardEnvelope = Static<typeof Protocol>;
export function parseEnvelope(value: unknown): BoardEnvelope {
	if (!Check(Protocol, value)) throw new Error("Invalid board host request");
	return value as BoardEnvelope;
}
export function isBoardEnvelope(value: unknown): boolean {
	return (
		!!value &&
		typeof value === "object" &&
		"operation" in value &&
		typeof value.operation === "string" &&
		value.operation.startsWith("board-")
	);
}
