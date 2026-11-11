import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	arr,
	bool,
	compile,
	int,
	nul,
	obj,
	opt,
	str,
	union,
	unsafe,
} from "@earendil-works/pi-schema";

const OPTIONAL_STRING = opt(str());
const OPTIONAL_BOOLEAN = opt(bool());
const MATCH = obj({ line_number: int(), line: str() }, { open: true });

// Pi codemode needs this declaration to return structuredContent rather than text.
export const NOTES_OUTPUT_SCHEMA = {
	...obj({}, { open: true }),
	additionalProperties: true,
};

const NOTES_RESULT_SCHEMA = obj(
	{
		file: opt(
			union([
				obj(
					{
						path: str(),
						content: OPTIONAL_STRING,
						append_only: OPTIONAL_BOOLEAN,
					},
					{ open: true },
				),
				nul(),
			]),
		),
		files: opt(
			arr(
				obj(
					{
						path: str(),
						updated_at: OPTIONAL_STRING,
						created_at: OPTIONAL_STRING,
						matches: opt(arr(MATCH)),
						truncated: OPTIONAL_BOOLEAN,
						append_only: OPTIONAL_BOOLEAN,
					},
					{ open: true },
				),
			),
		),
		usage: OPTIONAL_STRING,
		warnings: opt(arr(str())),
		warning: OPTIONAL_STRING,
		truncated: OPTIONAL_BOOLEAN,
		read_only: OPTIONAL_BOOLEAN,
		saved_at: OPTIONAL_STRING,
		captured_at: OPTIONAL_STRING,
		results: OPTIONAL_STRING,
		actions: opt(
			unsafe<Record<string, string>>({
				type: "object",
				patternProperties: { "^.*$": str() },
			}),
		),
		writes: OPTIONAL_STRING,
		paths: OPTIONAL_STRING,
		ranges: OPTIONAL_STRING,
		defaults: OPTIONAL_STRING,
	},
	{ open: false },
);

const notesResultSchemaValidator = compile(NOTES_RESULT_SCHEMA);

/** One canonical payload for native text and every programmatic caller. */
export function noteResult(payload: unknown): AgentToolResult<unknown> {
	if (!notesResultSchemaValidator.check(payload))
		throw new Error(
			"Notes returned invalid data. Read the note before retrying a write.",
		);
	// Keep recovery warnings, but omit sharing and storage bookkeeping.
	const {
		read_only: _readOnly,
		warning,
		saved_at: _savedAt,
		captured_at: _capturedAt,
		...visible
	} = payload;
	if (warning !== undefined)
		visible.warnings = [...(visible.warnings ?? []), warning];
	if (visible.file)
		visible.file = {
			path: visible.file.path,
			...(visible.file.content === undefined
				? {}
				: { content: visible.file.content }),
			...(visible.file.append_only === undefined
				? {}
				: { append_only: visible.file.append_only }),
		};
	if (visible.files)
		visible.files = visible.files.map(
			({ path, matches, truncated, append_only }) => ({
				path,
				...(matches === undefined ? {} : { matches }),
				...(truncated === undefined ? {} : { truncated }),
				...(append_only === undefined ? {} : { append_only }),
			}),
		);
	return {
		content: [{ type: "text", text: JSON.stringify(visible) }],
		structuredContent: visible,
		details: {},
	};
}
