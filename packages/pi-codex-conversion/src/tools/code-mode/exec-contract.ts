export const CODE_MODE_EXEC_GRAMMAR = String.raw`
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

export const CODE_MODE_EXEC_CONSTRAINED_SAMPLING = {
	type: "grammar",
	variants: { openai_lark: CODE_MODE_EXEC_GRAMMAR },
} as const;

export const CODE_MODE_EXEC_GRAMMAR_INPUTS: ReadonlyMap<string, string> =
	new Map([["exec", "code"]]);

export const MAX_EXEC_OUTPUT_TOKENS = 100_000;
export const DEFAULT_EXEC_OUTPUT_TOKENS = 10_000;
export const DEFAULT_EXEC_YIELD_MS = 30_000;

export const VM_RESET_EXEC = '// @exec: {"reset": true}';

export function parseExecSource(
	source: string,
	features: { allowIsolated?: boolean } = {},
): {
	code: string;
	yieldTimeMs: number | null;
	maxOutputTokens: number | null;
	isolated: boolean;
} {
	if (!source.trim()) throw new Error("exec requires non-empty source");
	const [first, ...rest] = source.split("\n");
	const trimmed = first?.trimStart() ?? "";
	if (!trimmed.startsWith("// @exec:"))
		return {
			code: source,
			yieldTimeMs: null,
			maxOutputTokens: null,
			isolated: false,
		};
	if (rest.join("\n").trim() === "")
		throw new Error("exec pragma must be followed by source");
	const options = JSON.parse(
		trimmed.slice("// @exec:".length).trim(),
	) as Record<string, unknown>;
	for (const key of Object.keys(options))
		if (
			key !== "yield_time_ms" &&
			key !== "max_output_tokens" &&
			!(features.allowIsolated && key === "isolated")
		)
			throw new Error(`Unsupported exec pragma field: ${key}`);
	if (
		options["isolated"] !== undefined &&
		typeof options["isolated"] !== "boolean"
	)
		throw new Error("isolated must be a boolean");
	return {
		code: rest.join("\n"),
		isolated: options["isolated"] === true,
		yieldTimeMs: parseInteger(options["yield_time_ms"], "yield_time_ms"),
		maxOutputTokens: parseInteger(
			options["max_output_tokens"],
			"max_output_tokens",
			1,
			MAX_EXEC_OUTPUT_TOKENS,
		),
	};
}

function parseInteger(
	value: unknown,
	name: string,
	minimum = 0,
	maximum = Number.MAX_SAFE_INTEGER,
): number | null {
	if (value === undefined) return null;
	if (
		!Number.isSafeInteger(value) ||
		Number(value) < minimum ||
		Number(value) > maximum
	)
		throw new Error(
			`${name} must be a safe integer from ${minimum} to ${maximum}`,
		);
	return Number(value);
}
