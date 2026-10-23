import { posix } from "node:path";
import parse from "shell-quote/parse.js";

type ReadDetection = { paths: string[]; unsupported: boolean };
type Token = parse.ParseEntry;

const MAX_TEXT = 65_536;
const MAX_PATH = 8_192;
const MAX_PATHS = 256;
const PATH_FIELDS = [
	"path",
	"file_path",
	"filePath",
	"target_file",
	"filename",
	"file",
	"paths",
	"file_paths",
	"filePaths",
	"target_files",
	"filenames",
] as const;
const READ_TOOL =
	/(?:^|[.:/\-_])(?:read(?:_?(?:(?:text|multiple)_?)?files?|_?file_?(?:contents?|lines)|_?hash)?|multi_?read|file_?read|view_?file|get_?file_?contents?|cat)$/i;
const READERS = new Set(["cat", "sed", "head", "tail"]);

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function rooted(path: string): boolean {
	return /^(?:\/|[A-Za-z]:\/|~(?:\/|$))/.test(path);
}

// Never resolve against the indexer's cwd or expand using its home/environment.
function normalise(
	path: string,
	cwd: string,
	expandHome = true,
): string | null {
	if (!path || path.length > MAX_PATH || /[\0\r\n]/.test(path)) return null;
	let value = path.replace(/\\/g, "/");
	if (expandHome) value = value.replace(/^\$(?:HOME|\{HOME\})(?=\/|$)/, "~");
	if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return null;
	if (!expandHome && /^~[^/]/.test(value)) return null;
	if (!rooted(value)) {
		if (!cwd || !rooted(cwd)) return null;
		value = `${cwd}/${value}`;
	}
	if (value === "~") return value;
	if (value.startsWith("~/")) {
		const tail = posix.normalize(value.slice(2));
		return tail === "." ? "~" : `~/${tail}`;
	}
	return posix.normalize(value);
}

function commandName(token: Token | undefined): string {
	return typeof token === "string" ? posix.basename(token) : "";
}

function operator(token: Token): string {
	return typeof token === "object" && "op" in token ? token.op : "";
}

function split(tokens: Token[], separator: string): Token[][] {
	const parts: Token[][] = [[]];
	for (const token of tokens) {
		if (operator(token) === separator) parts.push([]);
		else parts[parts.length - 1]?.push(token);
	}
	return parts;
}

function plausibleReader(tokens: Token[]): boolean {
	let start = true;
	for (const token of tokens) {
		if (typeof token !== "string") {
			if ([";", "&&", "||", "|", "&", "(", ")"].includes(operator(token)))
				start = true;
			continue;
		}
		if (!start) continue;
		if (["then", "do", "!", "if", "while", "until"].includes(token)) continue;
		if (READERS.has(commandName(token))) return true;
		start = false;
	}
	return false;
}

// shell-quote owns words/operators. This only preserves newline command boundaries,
// removes line comments, and rejects substitutions/unfinished quoting it cannot model.
function prepareShell(source: string): { text: string; unsafe: boolean } {
	let text = "";
	let quote = "";
	let escaped = false;
	let comment = false;
	let unsafe = false;
	let expansion = false;
	for (let i = 0; i < source.length; i++) {
		const char = source[i] ?? "";
		if (comment) {
			if (char !== "\n") continue;
			comment = false;
		}
		if (escaped) {
			if (char !== "\n") text += `\\${char}`;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (char === quote) quote = "";
		else if (!quote && (char === "'" || char === '"')) quote = char;
		else if (
			quote !== "'" &&
			(char === "`" || (char === "$" && source[i + 1] === "("))
		)
			unsafe = true;
		if (
			!quote &&
			char === "#" &&
			(i === 0 || /[\s;|&<>()]/.test(source[i - 1] ?? ""))
		) {
			comment = true;
			continue;
		}
		if (!quote && char === "$" && source[i + 1] === "{") expansion = true;
		if (!quote && char === "}" && expansion) expansion = false;
		else if (
			!quote &&
			(/[\[\]}]/.test(char) || (char === "{" && source[i - 1] !== "$"))
		)
			unsafe = true;
		// shell-quote treats even a mid-word hash as a comment; shells do not.
		if (!quote && char === "#") text += "\\";
		text +=
			char === "\n" && !quote
				? /(?:&&|\|\|?)[ \t]*$/.test(text)
					? " "
					: ";"
				: char;
	}
	return { text, unsafe: unsafe || Boolean(quote) || escaped };
}

function readerOperands(words: string[]): string[] | null {
	const name = commandName(words[0]);
	const files: string[] = [];
	let options = true;
	let sedQuiet = false;
	let sedScript = false;
	for (let i = 1; i < words.length; i++) {
		const word = words[i] ?? "";
		if (options && word === "--") {
			options = false;
			continue;
		}
		if (options && word.startsWith("-") && word !== "-") {
			if (["--help", "--version"].includes(word)) return [];
			if (name === "cat") {
				if (
					!/^(?:-[AbEnsTtuv]+|--(?:number|number-nonblank|squeeze-blank|show-all|show-ends|show-tabs|show-nonprinting))$/.test(
						word,
					)
				)
					return null;
			} else if (name === "sed") {
				if (["-n", "--quiet", "--silent"].includes(word)) sedQuiet = true;
				else if (["-E", "-r", "--regexp-extended"].includes(word)) continue;
				else if (word === "-e" || word === "--expression") {
					const script = words[++i];
					if (!script || !safeSedScript(script)) return null;
					sedScript = true;
				} else return null;
			} else if (["-n", "-c", "--lines", "--bytes"].includes(word)) {
				if (!/^[+-]?\d+$/.test(words[++i] ?? "")) return null;
			} else if (
				!/^(?:-\d+|-[qvz]+|--(?:quiet|silent|verbose|zero-terminated)|--(?:lines|bytes)=[+-]?\d+)$/.test(
					word,
				)
			)
				return null;
			continue;
		}
		if (name === "sed" && !sedScript) {
			if (!safeSedScript(word)) return null;
			sedScript = true;
		} else if (word !== "-") files.push(word);
	}
	return name === "sed" && (!sedQuiet || !sedScript) ? null : files;
}

function safeSedScript(script: string): boolean {
	return /^(?:(?:\d+|\$)?(?:,(?:\d+|\$))?p;?)+$/.test(script);
}

function shellReads(source: string, cwd: string): ReadDetection {
	const result: ReadDetection = { paths: [], unsupported: false };
	const prepared = prepareShell(source);
	let tokens: Token[];
	try {
		tokens = parse(prepared.text, (key) =>
			key === "HOME" ? "~" : { op: "unresolved" },
		);
	} catch {
		// A malformed reader command is still an explicit coverage gap, not evidence.
		result.unsupported =
			/(?:^|[;|&\n]\s*)\s*(?:\S*\/)?(?:cat|sed|head|tail)\b/.test(source);
		return result;
	}
	const plausible = plausibleReader(tokens);
	if (!plausible) return result;
	if (
		prepared.unsafe ||
		tokens.some(
			(token, index) =>
				["(", ")", "&", "||", ";;", "|&", "<(", "<<", "<<-", "<<<"].includes(
					operator(token),
				) ||
				(operator(token) === "<" && operator(tokens[index + 1] ?? "") === "<"),
		)
	) {
		return { paths: [], unsupported: true };
	}
	// Do not mistake commands inside shell control structures for executed reads.
	const starts = split(tokens, ";")
		.flatMap((part) => split(part, "&&"))
		.flatMap((part) => split(part, "|"));
	if (
		starts.some(
			(part) =>
				/^(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|set|shopt|exit|return|exec|eval|source|\.|alias|pushd|popd|trap|!|\{|\})$/.test(
					commandName(part[0]),
				) ||
				(typeof part[0] === "string" && /^\w+=/.test(part[0])),
		)
	) {
		return { paths: [], unsupported: true };
	}
	let currentCwd = cwd;
	const clauses = split(tokens, ";").filter((part) => part.length > 0);
	for (const [clauseIndex, clause] of clauses.entries()) {
		if (
			clause.some((token) => [">", ">>", ">&", "<&"].includes(operator(token)))
		) {
			result.unsupported ||= plausibleReader(clause);
			continue;
		}
		const chain = split(clause, "&&");
		// Only a literal cd may guard a read. Other conditions may never execute it.
		if (chain.length > 1) {
			const first = chain[0] ?? [];
			const args = first.filter(
				(token): token is string => typeof token === "string",
			);
			const target = args[1] === "--" ? args[2] : args[1];
			const nextCwd = target ? normalise(target, currentCwd, false) : null;
			if (
				chain.length !== 2 ||
				clauseIndex !== clauses.length - 1 ||
				first.length !== args.length ||
				args[0] !== "cd" ||
				args.length !== (args[1] === "--" ? 3 : 2) ||
				!nextCwd
			) {
				if (args[0] === "cd") currentCwd = "";
				result.unsupported ||= plausibleReader(clause);
				continue;
			}
			currentCwd = nextCwd;
			chain.shift();
		}
		for (const pipeline of chain) {
			for (const command of split(pipeline, "|")) {
				if (commandName(command[0]) === "cd") {
					// An unguarded cd might fail; subsequent relative reads are unresolved.
					currentCwd = "";
					continue;
				}
				if (!READERS.has(commandName(command[0]))) continue;
				const words: string[] = [];
				const inputPaths: string[] = [];
				let invalid = false;
				for (let i = 0; i < command.length; i++) {
					const token = command[i];
					if (
						token &&
						operator(token) === "<" &&
						typeof command[i + 1] === "string"
					) {
						inputPaths.push(String(command[++i]));
					} else if (typeof token === "string") words.push(token);
					else invalid = true;
				}
				const operands = invalid ? null : readerOperands(words);
				if (!operands || inputPaths.length > 1) {
					result.unsupported = true;
					continue;
				}
				for (const path of [...inputPaths, ...operands]) {
					const resolved = normalise(path, currentCwd, false);
					if (resolved) result.paths.push(resolved);
					else result.unsupported = true;
				}
			}
		}
	}
	return result;
}

/** Recorded invocation evidence only; the caller owns success/outcome filtering. */
export function detectFileReads(
	tool: string,
	args: unknown,
	sessionCwd: string,
): ReadDetection & { shell: boolean } {
	const input = record(args);
	const result: ReadDetection = { paths: [], unsupported: false };
	const shell =
		typeof input["cmd"] === "string" || typeof input["command"] === "string";
	const base = normalise(sessionCwd, "") ?? "";
	const explicitCwd = input["workdir"] ?? input["cwd"];
	const cwd =
		typeof explicitCwd === "string"
			? (normalise(explicitCwd, base) ?? "")
			: base;
	const operation = input["operation"] ?? input["action"];
	const readTool = READ_TOOL.test(tool.slice(0, 256));
	if (
		readTool ||
		(typeof operation === "string" &&
			/^(?:read|read_file|readfile)$/i.test(operation))
	) {
		let hasTarget = false;
		for (const field of [...PATH_FIELDS, "files"]) {
			const value = input[field];
			if (value === undefined) continue;
			hasTarget = true;
			const values = Array.isArray(value) ? value.slice(0, MAX_PATHS) : [value];
			if (Array.isArray(value) && value.length > MAX_PATHS)
				result.unsupported = true;
			for (const value of values) {
				const entry = record(value);
				const path =
					field === "files" && typeof value !== "string"
						? PATH_FIELDS.map((key) => entry[key]).find(
								(item) => typeof item === "string",
							)
						: value;
				const resolved = typeof path === "string" ? normalise(path, cwd) : null;
				if (resolved) result.paths.push(resolved);
				else result.unsupported = true;
			}
		}
		if (readTool && !hasTarget && !shell) result.unsupported = true;
	}
	for (const field of ["cmd", "command"]) {
		const command = input[field];
		if (typeof command !== "string") continue;
		if (command.length > MAX_TEXT) {
			result.unsupported ||=
				/(?:^|[;|&\n]\s*)\s*(?:\S*\/)?(?:cat|sed|head|tail)\b/.test(
					command.slice(0, MAX_TEXT),
				);
			continue;
		}
		const shell = shellReads(command, cwd);
		result.paths.push(...shell.paths);
		result.unsupported ||= shell.unsupported;
	}
	const paths = [...new Set(result.paths)];
	return {
		paths: paths.slice(0, MAX_PATHS),
		unsupported: result.unsupported || paths.length > MAX_PATHS,
		shell,
	};
}
