import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

const OPTIONAL_STRING = Type.Optional(Type.String());
const OPTIONAL_BOOLEAN = Type.Optional(Type.Boolean());
const MATCH = Type.Object({ line_number: Type.Integer(), line: Type.String() });

// Pi codemode needs this declaration to return structuredContent rather than text.
export const NOTES_OUTPUT_SCHEMA = Type.Object(
	{},
	{ additionalProperties: true },
);

const NOTES_RESULT_SCHEMA = Type.Object(
	{
		file: Type.Optional(
			Type.Union([
				Type.Object({
					path: Type.String(),
					content: OPTIONAL_STRING,
					start_line: Type.Optional(Type.Integer()),
					stop_line: Type.Optional(Type.Integer()),
					total_lines: Type.Optional(Type.Integer()),
					append_only: OPTIONAL_BOOLEAN,
				}),
				Type.Null(),
			]),
		),
		files: Type.Optional(
			Type.Array(
				Type.Object({
					path: Type.String(),
					updated_at: OPTIONAL_STRING,
					created_at: OPTIONAL_STRING,
					matches: Type.Optional(Type.Array(MATCH)),
					truncated: OPTIONAL_BOOLEAN,
					append_only: OPTIONAL_BOOLEAN,
				}),
			),
		),
		usage: OPTIONAL_STRING,
		warnings: Type.Optional(Type.Array(Type.String())),
		warning: OPTIONAL_STRING,
		truncated: OPTIONAL_BOOLEAN,
		read_only: OPTIONAL_BOOLEAN,
		saved_at: OPTIONAL_STRING,
		captured_at: OPTIONAL_STRING,
		results: OPTIONAL_STRING,
		actions: Type.Optional(Type.Record(Type.String(), Type.String())),
		writes: OPTIONAL_STRING,
		paths: OPTIONAL_STRING,
		ranges: OPTIONAL_STRING,
		defaults: OPTIONAL_STRING,
	},
	{ additionalProperties: false },
);

/** One canonical payload for native text and every programmatic caller. */
export function noteResult(payload: unknown): AgentToolResult<unknown> {
	if (!Check(NOTES_RESULT_SCHEMA, payload))
		throw new Error(
			"Notes returned invalid data. Read the note before retrying a write.",
		);
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		structuredContent: payload,
		details: {},
	};
}
