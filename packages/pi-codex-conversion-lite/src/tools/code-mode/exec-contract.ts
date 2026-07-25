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

export const CODE_MODE_EXEC_GRAMMAR_INPUTS: ReadonlyMap<string, string> = new Map([["exec", "code"]]);
