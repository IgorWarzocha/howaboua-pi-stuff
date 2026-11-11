import {
	arr,
	bool,
	compile,
	int,
	lit,
	nul,
	obj,
	opt,
	type Static,
	str,
	union,
	unknown,
} from "@earendil-works/pi-schema";
import { BindingSchema } from "./identity.js";

const NoticeSchema = obj(
	{
		message_id: str(),
		channel_name: str(),
		author: str(),
		thread_id: str(),
		created_at: str(),
		text_preview: str({ maxLength: 300 }),
		n_chars: int({ minimum: 0 }),
		truncated: bool(),
	},
	{ open: false },
);
const Protocol = union([
	obj(
		{
			operation: lit("board-catchup"),
			caller: BindingSchema,
			seen: arr(str()),
		},
		{ open: true },
	),
	obj(
		{
			operation: lit("board-bind"),
			binding: BindingSchema,
		},
		{ open: true },
	),
	obj(
		{
			operation: lit("board-register"),
			caller: BindingSchema,
			member: BindingSchema,
		},
		{ open: true },
	),
	obj(
		{
			operation: lit("board-unregister"),
			caller: BindingSchema,
			member: BindingSchema,
		},
		{ open: true },
	),
	obj(
		{
			operation: lit("board-enabled"),
			boardId: str(),
			enabled: bool(),
		},
		{ open: true },
	),
	obj(
		{
			operation: lit("board-active"),
			caller: BindingSchema,
			turnId: union([str(), nul()]),
			previousTurnId: opt(str()),
		},
		{ open: true },
	),
	obj(
		{
			operation: lit("board-call"),
			caller: BindingSchema,
			params: unknown(),
			requestId: str(),
		},
		{ open: true },
	),
	obj(
		{
			operation: lit("board-notify"),
			boardId: str(),
			target: str(),
			route: opt(arr(str())),
			sessionId: str(),
			turnId: str(),
			notice: NoticeSchema,
		},
		{ open: true },
	),
]);
export type BoardEnvelope = Static<typeof Protocol>;
const protocolValidator = compile(Protocol);

export function parseEnvelope(value: unknown): BoardEnvelope {
	if (!protocolValidator.check(value))
		throw new Error("Invalid board host request");
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
