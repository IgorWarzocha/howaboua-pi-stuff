import { extractBashCommand, parseShellLcPlainCommands } from "./bash.ts";
import {
	isAbsoluteLike,
	joinCommandTokens,
	joinPaths,
	normalizeTokens,
	shellSplit,
	shortDisplayPath,
	splitOnConnectors,
} from "./tokenize.ts";

export type ParsedShellCommand =
	| { kind: "read"; command: string; name: string; path: string }
	| { kind: "list"; command: string; path?: string | undefined }
	| { kind: "search"; command: string; query?: string | undefined; path?: string | undefined }
	| { kind: "unknown"; command: string };

export function parseCommandString(command: string): ParsedShellCommand[] {
	return parseCommandTokens(shellSplit(command));
}

export function parseCommandTokens(command: string[]): ParsedShellCommand[] {
	const parsed = parseCommandImpl(command);
	const deduped: ParsedShellCommand[] = [];
	for (const part of parsed) {
		const previous = (deduped[deduped.length - 1])!;
		if (previous && JSON.stringify(previous) === JSON.stringify(part)) continue;
		deduped.push(part);
	}
	if (deduped.some((part) => part.kind === "unknown")) {
		return [singleUnknownForCommand(command)];
	}
	return deduped;
}

function parseCommandImpl(command: string[]): ParsedShellCommand[] {
	const shellCommands = parseShellLcCommands(command);
	if (shellCommands) return shellCommands;

	const powerShellScript = extractPowerShellCommand(command);
	if (powerShellScript) {
		return [{ kind: "unknown", command: powerShellScript[1]! }];
	}

	const normalized = normalizeTokens(command);
	const parts = containsConnectors(normalized) ? splitOnConnectors(normalized) : [normalized];
	const effectiveParts = parts.length > 1 ? parts.filter((part) => !isSmallFormattingCommand(part)) : parts;
	if (effectiveParts.length === 0) {
		return [{ kind: "unknown", command: joinCommandTokens(command) }];
	}

	const commands: ParsedShellCommand[] = [];
	let cwd: string | undefined;
	for (const tokens of effectiveParts) {
		if (tokens[0] === "cd") {
			const target = cdTarget(tokens.slice(1));
			if (target) cwd = cwd ? joinPaths(cwd, target) : target;
			continue;
		}

		const parsed = summarizeMainTokens(tokens);
		if (parsed.kind === "read" && cwd) {
			commands.push({ ...parsed, path: joinPaths(cwd, parsed.path) });
		} else {
			commands.push(parsed);
		}
	}

	let simplified = commands;
	while (true) {
		const next = simplifyOnce(simplified);
		if (!next) break;
		simplified = next;
	}

	return simplified;
}

function singleUnknownForCommand(command: string[]): ParsedShellCommand {
	const shell = extractShellCommand(command);
	if (shell) return { kind: "unknown", command: shell[1]! };
	return { kind: "unknown", command: joinCommandTokens(command) };
}

function extractShellCommand(command: string[]): [shell: string, script: string] | undefined {
	return extractBashCommand(command) ?? extractPowerShellCommand(command);
}

function extractPowerShellCommand(command: string[]): [shell: string, script: string] | undefined {
	if (command.length < 3) return undefined;
	const shell = command[0]!;
	const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	if (shellName !== "powershell" && shellName !== "powershell.exe" && shellName !== "pwsh" && shellName !== "pwsh.exe") {
		return undefined;
	}
	for (let index = 1; index + 1 < command.length; index++) {
		const flag = command[index]!?.toLowerCase();
		if (flag !== "-nologo" && flag !== "-noprofile" && flag !== "-command" && flag !== "-c") {
			return undefined;
		}
		if (flag === "-command" || flag === "-c") {
			return [shell, command[index + 1]!];
		}
	}
	return undefined;
}

function parseShellLcCommands(original: string[]): ParsedShellCommand[] | undefined {
	const bash = extractBashCommand(original);
	if (!bash) return undefined;
	const [, script] = bash;
	const allCommands = parseShellLcPlainCommands(original);
	if (!allCommands || allCommands.length === 0) {
		return [{ kind: "unknown", command: script }];
	}

	const scriptTokens = shellSplit(script);
	const hadMultipleCommands = allCommands.length > 1;
	const filteredCommands = dropSmallFormattingCommands(allCommands);
	if (filteredCommands.length === 0) {
		return [{ kind: "unknown", command: script }];
	}

	let commands: ParsedShellCommand[] = [];
	let cwd: string | undefined;
	for (const tokens of filteredCommands) {
		if (tokens[0] === "cd") {
			const target = cdTarget(tokens.slice(1));
			if (target) cwd = cwd ? joinPaths(cwd, target) : target;
			continue;
		}

		const parsed = summarizeMainTokens(tokens);
		if (parsed.kind === "read" && cwd) {
			commands.push({ ...parsed, path: joinPaths(cwd, parsed.path) });
		} else {
			commands.push(parsed);
		}
	}

	if (commands.length > 1) {
		commands = commands.filter((command) => !(command.kind === "unknown" && command.command === "true"));
		while (true) {
			const next = simplifyOnce(commands);
			if (!next) break;
			commands = next;
		}
	}

	if (commands.length === 1) {
		const hadConnectors = hadMultipleCommands || scriptTokens.some((token) => token === "|" || token === "&&" || token === "||" || token === ";");
		commands = commands.map((command) => {
			if (command.kind === "read") {
				if (hadConnectors) {
					const hasPipe = scriptTokens.includes("|");
					const hasSedN = scriptTokens.some((token, index) => token === "sed" && scriptTokens[index + 1] === "-n");
					if (hasPipe && hasSedN) {
						return { ...command, command: script };
					}
					return command;
				}
				return { ...command, command: joinCommandTokens(scriptTokens) };
			}
			if (command.kind === "list") {
				return hadConnectors ? command : { ...command, command: joinCommandTokens(scriptTokens) };
			}
			if (command.kind === "search") {
				return hadConnectors ? command : { ...command, command: joinCommandTokens(scriptTokens) };
			}
			return command;
		});
	}

	return commands;
}

function containsConnectors(tokens: string[]): boolean {
	return tokens.some((token) => token === "&&" || token === "||" || token === "|" || token === ";");
}

function simplifyOnce(commands: ParsedShellCommand[]): ParsedShellCommand[] | undefined {
	if (commands.length <= 1) return undefined;

	if (commands[0]!?.kind === "unknown") {
		const tokens = shellSplit(commands[0]!.command);
		if (tokens[0] === "echo") return commands.slice(1);
	}

	const cdIndex = commands.findIndex((command) => command.kind === "unknown" && shellSplit(command.command)[0] === "cd");
	if (cdIndex !== -1 && commands.length > cdIndex + 1) {
		return [...commands.slice(0, cdIndex), ...commands.slice(cdIndex + 1)];
	}

	const trueIndex = commands.findIndex((command) => command.kind === "unknown" && command.command === "true");
	if (trueIndex !== -1) {
		return [...commands.slice(0, trueIndex), ...commands.slice(trueIndex + 1)];
	}

	const nlIndex = commands.findIndex((command) => {
		if (command.kind !== "unknown") return false;
		const tokens = shellSplit(command.command);
		return tokens[0] === "nl" && tokens.slice(1).every((token) => token.startsWith("-"));
	});
	if (nlIndex !== -1) {
		return [...commands.slice(0, nlIndex), ...commands.slice(nlIndex + 1)];
	}

	return undefined;
}

export function isSmallFormattingCommand(tokens: string[]): boolean {
	if (tokens.length === 0) return false;
	const command = tokens[0]!;
	if (command === "wc" || command === "tr" || command === "cut" || command === "sort" || command === "uniq" || command === "tee" || command === "column" || command === "yes" || command === "printf") {
		return true;
	}
	if (command === "xargs") return !isMutatingXargsCommand(tokens);
	if (command === "awk") return awkDataFileOperand(tokens.slice(1)) === undefined;
	if (command === "head") {
		if (tokens.length === 1) return true;
		if (tokens.length === 2) return tokens[1]!.startsWith("-");
		if (tokens.length === 3 && (tokens[1] === "-n" || tokens[1] === "-c") && /^[0-9]+$/.test(tokens[2]!)) return true;
		return false;
	}
	if (command === "tail") {
		if (tokens.length === 1) return true;
		if (tokens.length === 2) return tokens[1]!.startsWith("-");
		if (tokens.length === 3 && (tokens[1] === "-n" || tokens[1] === "-c")) {
			const value = tokens[2]!.startsWith("+") ? tokens[2]!.slice(1) : tokens[2]!;
			return value.length > 0 && /^[0-9]+$/.test(value);
		}
		return false;
	}
	if (command === "sed") return sedReadPath(tokens.slice(1)) === undefined;
	return false;
}

function dropSmallFormattingCommands(commands: string[][]): string[][] {
	return commands.filter((command) => !isSmallFormattingCommand(command));
}

function summarizeMainTokens(mainCommand: string[]): ParsedShellCommand {
	const [head, ...tail] = mainCommand;
	if (!head) return { kind: "unknown", command: joinCommandTokens(mainCommand) };

	if (head === "ls" || head === "eza" || head === "exa") {
		const flagsWithValues =
			head === "ls"
				? ["-I", "-w", "--block-size", "--format", "--time-style", "--color", "--quoting-style"]
				: ["-I", "--ignore-glob", "--color", "--sort", "--time-style", "--time"];
		const path = firstNonFlagOperand(tail, flagsWithValues);
		return { kind: "list", command: joinCommandTokens(mainCommand), path: path ? shortDisplayPath(path) : undefined };
	}
	if (head === "tree") {
		const path = firstNonFlagOperand(tail, ["-L", "-P", "-I", "--charset", "--filelimit", "--sort"]);
		return { kind: "list", command: joinCommandTokens(mainCommand), path: path ? shortDisplayPath(path) : undefined };
	}
	if (head === "du") {
		const path = firstNonFlagOperand(tail, ["-d", "--max-depth", "-B", "--block-size", "--exclude", "--time-style"]);
		return { kind: "list", command: joinCommandTokens(mainCommand), path: path ? shortDisplayPath(path) : undefined };
	}
	if (head === "rg" || head === "rga" || head === "ripgrep-all") {
		const args = trimAtConnector(tail);
		const hasFilesFlag = args.includes("--files");
		const candidates = skipFlagValues(args, ["-g", "--glob", "--iglob", "-t", "--type", "--type-add", "--type-not", "-m", "--max-count", "-A", "-B", "-C", "--context", "--max-depth"]);
		const nonFlags = candidates.filter((token) => !token.startsWith("-"));
		if (hasFilesFlag) {
			return { kind: "list", command: joinCommandTokens(mainCommand), path: nonFlags[0]! ? shortDisplayPath(nonFlags[0]!) : undefined };
		}
		return { kind: "search", command: joinCommandTokens(mainCommand), query: nonFlags[0]!, path: nonFlags[1]! ? shortDisplayPath(nonFlags[1]!) : undefined };
	}
	if (head === "git") {
		const [subcommand, ...subtail] = tail;
		if (subcommand === "grep") return parseGrepLike(mainCommand, subtail);
		if (subcommand === "ls-files") {
			const path = firstNonFlagOperand(subtail, ["--exclude", "--exclude-from", "--pathspec-from-file"]);
			return { kind: "list", command: joinCommandTokens(mainCommand), path: path ? shortDisplayPath(path) : undefined };
		}
		return { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "fd") {
		const [query, path] = parseFdQueryAndPath(tail);
		return query ? { kind: "search", command: joinCommandTokens(mainCommand), query, path } : { kind: "list", command: joinCommandTokens(mainCommand), path };
	}
	if (head === "find") {
		const [query, path] = parseFindQueryAndPath(tail);
		return query ? { kind: "search", command: joinCommandTokens(mainCommand), query, path } : { kind: "list", command: joinCommandTokens(mainCommand), path };
	}
	if (head === "grep" || head === "egrep" || head === "fgrep") return parseGrepLike(mainCommand, tail);
	if (head === "ag" || head === "ack" || head === "pt") {
		const args = trimAtConnector(tail);
		const candidates = skipFlagValues(args, ["-G", "-g", "--file-search-regex", "--ignore-dir", "--ignore-file", "--path-to-ignore"]);
		const nonFlags = candidates.filter((token) => !token.startsWith("-"));
		return { kind: "search", command: joinCommandTokens(mainCommand), query: nonFlags[0]!, path: nonFlags[1]! ? shortDisplayPath(nonFlags[1]!) : undefined };
	}
	if (head === "cat") {
		const path = singleNonFlagOperand(tail, []);
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "bat" || head === "batcat") {
		const path = singleNonFlagOperand(tail, ["--theme", "--language", "--style", "--terminal-width", "--tabs", "--line-range", "--map-syntax"]);
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "less") {
		const path = singleNonFlagOperand(tail, ["-p", "-P", "-x", "-y", "-z", "-j", "--pattern", "--prompt", "--tabs", "--shift", "--jump-target"]);
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "more") {
		const path = singleNonFlagOperand(tail, []);
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "head") {
		const path = readPathFromHeadTail(tail, "head");
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "tail") {
		const path = readPathFromHeadTail(tail, "tail");
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "awk") {
		const path = awkDataFileOperand(tail);
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "nl") {
		const candidates = skipFlagValues(tail, ["-s", "-w", "-v", "-i", "-b"]);
		const path = candidates.find((token) => !token.startsWith("-"));
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (head === "sed") {
		const path = sedReadPath(tail);
		return path ? readCommand(mainCommand, path) : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	if (isPythonCommand(head)) {
		return pythonWalksFiles(tail) ? { kind: "list", command: joinCommandTokens(mainCommand) } : { kind: "unknown", command: joinCommandTokens(mainCommand) };
	}
	return { kind: "unknown", command: joinCommandTokens(mainCommand) };
}

function parseGrepLike(mainCommand: string[], args: string[]): ParsedShellCommand {
	const trimmed = trimAtConnector(args);
	const operands: string[] = [];
	let pattern: string | undefined;
	let afterDoubleDash = false;
	for (let index = 0; index < trimmed.length; index++) {
		const arg = trimmed[index]!;
		if (afterDoubleDash) {
			operands.push(arg);
			continue;
		}
		if (arg === "--") {
			afterDoubleDash = true;
			continue;
		}
		if (arg === "-e" || arg === "--regexp") {
			if (!pattern) pattern = (trimmed[index + 1])!;
			index += 1;
			continue;
		}
		if (arg === "-f" || arg === "--file") {
			if (!pattern) pattern = (trimmed[index + 1])!;
			index += 1;
			continue;
		}
		if (arg === "-m" || arg === "--max-count" || arg === "-C" || arg === "--context" || arg === "-A" || arg === "--after-context" || arg === "-B" || arg === "--before-context") {
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		operands.push(arg);
	}
	const hasPattern = pattern !== undefined;
	const query = pattern ?? operands[0]!;
	const pathIndex = hasPattern ? 0 : 1;
	return { kind: "search", command: joinCommandTokens(mainCommand), query, path: operands[pathIndex]! ? shortDisplayPath(operands[pathIndex]!) : undefined };
}

function readCommand(mainCommand: string[], path: string): ParsedShellCommand {
	return { kind: "read", command: joinCommandTokens(mainCommand), name: shortDisplayPath(path), path };
}

function trimAtConnector(tokens: string[]): string[] {
	const index = tokens.findIndex((token) => token === "|" || token === "&&" || token === "||" || token === ";");
	return index === -1 ? [...tokens] : tokens.slice(0, index);
}

function skipFlagValues(args: string[], flagsWithValues: string[]): string[] {
	const out: string[] = [];
	let skipNext = false;
	for (let index = 0; index < args.length; index++) {
		const token = args[index]!;
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (token === "--") {
			out.push(...args.slice(index + 1));
			break;
		}
		if (token.startsWith("--") && token.includes("=")) continue;
		if (flagsWithValues.includes(token)) {
			if (index + 1 < args.length) skipNext = true;
			continue;
		}
		out.push(token);
	}
	return out;
}

function positionalOperands(args: string[], flagsWithValues: string[]): string[] {
	const out: string[] = [];
	let afterDoubleDash = false;
	let skipNext = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (afterDoubleDash) {
			out.push(arg);
			continue;
		}
		if (arg === "--") {
			afterDoubleDash = true;
			continue;
		}
		if (arg.startsWith("--") && arg.includes("=")) continue;
		if (flagsWithValues.includes(arg)) {
			if (index + 1 < args.length) skipNext = true;
			continue;
		}
		if (arg.startsWith("-")) continue;
		out.push(arg);
	}
	return out;
}

function firstNonFlagOperand(args: string[], flagsWithValues: string[]): string | undefined {
	return (positionalOperands(args, flagsWithValues)[0])!;
}

function singleNonFlagOperand(args: string[], flagsWithValues: string[]): string | undefined {
	const operands = positionalOperands(args, flagsWithValues);
	return operands.length === 1 ? operands[0]! : undefined;
}

function awkDataFileOperand(args: string[]): string | undefined {
	if (args.length === 0) return undefined;
	const trimmed = trimAtConnector(args);
	const hasScriptFile = trimmed.some((arg) => arg === "-f" || arg === "--file");
	const candidates = skipFlagValues(trimmed, ["-F", "-v", "-f", "--field-separator", "--assign", "--file"]);
	const nonFlags = candidates.filter((arg) => !arg.startsWith("-"));
	if (hasScriptFile) return nonFlags[0]!;
	return nonFlags.length >= 2 ? nonFlags[1]! : undefined;
}

function pythonWalksFiles(args: string[]): boolean {
	const trimmed = trimAtConnector(args);
	for (let index = 0; index < trimmed.length; index++) {
		if (trimmed[index] !== "-c") continue;
		const script = (trimmed[index + 1])!;
		if (!script) continue;
		return script.includes("os.walk") || script.includes("os.listdir") || script.includes("os.scandir") || script.includes("glob.glob") || script.includes("glob.iglob") || script.includes("pathlib.Path") || script.includes(".rglob(");
	}
	return false;
}

function isPythonCommand(command: string): boolean {
	return command === "python" || command === "python2" || command === "python3" || command.startsWith("python2.") || command.startsWith("python3.");
}

function cdTarget(args: string[]): string | undefined {
	if (args.length === 0) return undefined;
	let target: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (arg === "--") return (args[index + 1])!;
		if (arg === "-L" || arg === "-P") continue;
		if (arg.startsWith("-")) continue;
		target = arg;
	}
	return target;
}

function isPathish(value: string): boolean {
	return value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") || value.includes("/") || value.includes("\\");
}

function parseFdQueryAndPath(args: string[]): [string | undefined, string | undefined] {
	const trimmed = trimAtConnector(args);
	const candidates = skipFlagValues(trimmed, ["-t", "--type", "-e", "--extension", "-E", "--exclude", "--search-path"]);
	const nonFlags = candidates.filter((token) => !token.startsWith("-"));
	if (nonFlags.length === 1) {
		return isPathish(nonFlags[0]!) ? [undefined, shortDisplayPath(nonFlags[0]!)] : [nonFlags[0]!, undefined];
	}
	if (nonFlags.length >= 2) return [nonFlags[0]!, shortDisplayPath(nonFlags[1]!)];
	return [undefined, undefined];
}

function parseFindQueryAndPath(args: string[]): [string | undefined, string | undefined] {
	const trimmed = trimAtConnector(args);
	let path: string | undefined;
	for (const arg of trimmed) {
		if (!arg.startsWith("-") && arg !== "!" && arg !== "(" && arg !== ")") {
			path = shortDisplayPath(arg);
			break;
		}
	}
	let query: string | undefined;
	for (let index = 0; index < trimmed.length; index++) {
		const arg = trimmed[index]!;
		if (arg === "-name" || arg === "-iname" || arg === "-path" || arg === "-regex") {
			query = (trimmed[index + 1])!;
			break;
		}
	}
	return [query, path];
}

function readPathFromHeadTail(args: string[], tool: "head" | "tail"): string | undefined {
	if (args.length === 1 && !args[0]!.startsWith("-")) return args[0]!;
	if (tool === "head") {
		const hasValidN = args[0] === "-n" ? /^[0-9]+$/.test(args[1] ?? "") : (args[0]!?.startsWith("-n") ?? false) && /^[0-9]+$/.test(args[0]!.slice(2));
		if (hasValidN) {
			const candidates: string[] = [];
			for (let index = 0; index < args.length; index++) {
				if (index === 0 && args[index] === "-n" && /^[0-9]+$/.test(args[index + 1] ?? "")) {
					index += 1;
					continue;
				}
				candidates.push(args[index]!);
			}
			return candidates.find((candidate) => !candidate.startsWith("-"));
		}
		return undefined;
	}
	const hasValidN = args[0] === "-n"
		? /^\+?[0-9]+$/.test(args[1] ?? "")
		: (args[0]!?.startsWith("-n") ?? false) && /^\+?[0-9]+$/.test(args[0]!.slice(2));
	if (hasValidN) {
		const candidates: string[] = [];
		for (let index = 0; index < args.length; index++) {
			if (index === 0 && args[index] === "-n" && /^\+?[0-9]+$/.test(args[index + 1] ?? "")) {
				index += 1;
				continue;
			}
			candidates.push(args[index]!);
		}
		return candidates.find((candidate) => !candidate.startsWith("-"));
	}
	return undefined;
}

function isValidSedRange(value: string | undefined): boolean {
	if (!value || !value.endsWith("p")) return false;
	const core = value.slice(0, -1);
	const parts = core.split(",");
	return parts.length >= 1 && parts.length <= 2 && parts.every((part) => part.length > 0 && /^[0-9]+$/.test(part));
}

function sedReadPath(args: string[]): string | undefined {
	const trimmed = trimAtConnector(args);
	if (!trimmed.includes("-n")) return undefined;
	let hasRangeScript = false;
	for (let index = 0; index < trimmed.length; index++) {
		const token = trimmed[index]!;
		if ((token === "-e" || token === "--expression") && isValidSedRange((trimmed[index + 1])!)) {
			hasRangeScript = true;
		}
		if (!token.startsWith("-") && isValidSedRange(token)) {
			hasRangeScript = true;
		}
	}
	if (!hasRangeScript) return undefined;
	const candidates = skipFlagValues(trimmed, ["-e", "-f", "--expression", "--file"]);
	const nonFlags = candidates.filter((token) => !token.startsWith("-"));
	if (nonFlags.length === 0) return undefined;
	if (isValidSedRange(nonFlags[0]!)) return nonFlags[1]!;
	return nonFlags[0]!;
}

function isMutatingXargsCommand(tokens: string[]): boolean {
	return xargsSubcommand(tokens)?.length ? xargsIsMutatingSubcommand(xargsSubcommand(tokens)!) : false;
}

function xargsSubcommand(tokens: string[]): string[] | undefined {
	if (tokens[0] !== "xargs") return undefined;
	let index = 1;
	while (index < tokens.length) {
		const token = tokens[index]!;
		if (token === "--") return tokens.slice(index + 1);
		if (!token.startsWith("-")) return tokens.slice(index);
		const takesValue = token === "-E" || token === "-e" || token === "-I" || token === "-L" || token === "-n" || token === "-P" || token === "-s";
		index += takesValue && token.length === 2 ? 2 : 1;
	}
	return undefined;
}

function xargsIsMutatingSubcommand(tokens: string[]): boolean {
	const [head, ...tail] = tokens;
	if (!head) return false;
	if (head === "perl" || head === "ruby") return xargsHasInPlaceFlag(tail);
	if (head === "sed") return xargsHasInPlaceFlag(tail) || tail.includes("--in-place");
	if (head === "rg") return tail.includes("--replace");
	return false;
}

function xargsHasInPlaceFlag(tokens: string[]): boolean {
	return tokens.some((token) => token === "-i" || token.startsWith("-i") || token === "-pi" || token.startsWith("-pi"));
}

export function isAbsolutePathLike(path: string): boolean {
	return isAbsoluteLike(path);
}
