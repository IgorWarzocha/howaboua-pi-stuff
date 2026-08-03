import { extractBashCommand, parseShellLcPlainCommands } from "./bash.ts";
import { cdTarget } from "./command-operands.ts";
import {
	isSmallFormattingCommand,
	summarizeMainTokens,
} from "./command-summary.ts";
import type { ParsedShellCommand } from "./parsed-command.ts";
import {
	isAbsoluteLike,
	joinCommandTokens,
	joinPaths,
	normalizeTokens,
	shellSplit,
	splitOnConnectors,
} from "./tokenize.ts";

export { isSmallFormattingCommand } from "./command-summary.ts";
export type { ParsedShellCommand } from "./parsed-command.ts";

export function parseCommandString(command: string): ParsedShellCommand[] {
	return parseCommandTokens(shellSplit(command));
}

export function parseCommandTokens(command: string[]): ParsedShellCommand[] {
	const parsed = parseCommandImpl(command);
	const deduped: ParsedShellCommand[] = [];
	for (const part of parsed) {
		const previous = deduped[deduped.length - 1]!;
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
	const parts = containsConnectors(normalized)
		? splitOnConnectors(normalized)
		: [normalized];
	const effectiveParts =
		parts.length > 1
			? parts.filter((part) => !isSmallFormattingCommand(part))
			: parts;
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

function extractShellCommand(
	command: string[],
): [shell: string, script: string] | undefined {
	return extractBashCommand(command) ?? extractPowerShellCommand(command);
}

function extractPowerShellCommand(
	command: string[],
): [shell: string, script: string] | undefined {
	if (command.length < 3) return undefined;
	const shell = command[0]!;
	const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	if (
		shellName !== "powershell" &&
		shellName !== "powershell.exe" &&
		shellName !== "pwsh" &&
		shellName !== "pwsh.exe"
	) {
		return undefined;
	}
	for (let index = 1; index + 1 < command.length; index++) {
		const flag = command[index]?.toLowerCase();
		if (
			flag !== "-nologo" &&
			flag !== "-noprofile" &&
			flag !== "-command" &&
			flag !== "-c"
		) {
			return undefined;
		}
		if (flag === "-command" || flag === "-c") {
			return [shell, command[index + 1]!];
		}
	}
	return undefined;
}

function parseShellLcCommands(
	original: string[],
): ParsedShellCommand[] | undefined {
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
		commands = commands.filter(
			(command) => !(command.kind === "unknown" && command.command === "true"),
		);
		while (true) {
			const next = simplifyOnce(commands);
			if (!next) break;
			commands = next;
		}
	}

	if (commands.length === 1) {
		const hadConnectors =
			hadMultipleCommands ||
			scriptTokens.some(
				(token) =>
					token === "|" || token === "&&" || token === "||" || token === ";",
			);
		commands = commands.map((command) => {
			if (command.kind === "read") {
				if (hadConnectors) {
					const hasPipe = scriptTokens.includes("|");
					const hasSedN = scriptTokens.some(
						(token, index) =>
							token === "sed" && scriptTokens[index + 1] === "-n",
					);
					if (hasPipe && hasSedN) {
						return { ...command, command: script };
					}
					return command;
				}
				return { ...command, command: joinCommandTokens(scriptTokens) };
			}
			if (command.kind === "list") {
				return hadConnectors
					? command
					: { ...command, command: joinCommandTokens(scriptTokens) };
			}
			if (command.kind === "search") {
				return hadConnectors
					? command
					: { ...command, command: joinCommandTokens(scriptTokens) };
			}
			return command;
		});
	}

	return commands;
}

function containsConnectors(tokens: string[]): boolean {
	return tokens.some(
		(token) =>
			token === "&&" || token === "||" || token === "|" || token === ";",
	);
}

function simplifyOnce(
	commands: ParsedShellCommand[],
): ParsedShellCommand[] | undefined {
	if (commands.length <= 1) return undefined;

	if (commands[0]?.kind === "unknown") {
		const tokens = shellSplit(commands[0]!.command);
		if (tokens[0] === "echo") return commands.slice(1);
	}

	const cdIndex = commands.findIndex(
		(command) =>
			command.kind === "unknown" && shellSplit(command.command)[0] === "cd",
	);
	if (cdIndex !== -1 && commands.length > cdIndex + 1) {
		return [...commands.slice(0, cdIndex), ...commands.slice(cdIndex + 1)];
	}

	const trueIndex = commands.findIndex(
		(command) => command.kind === "unknown" && command.command === "true",
	);
	if (trueIndex !== -1) {
		return [...commands.slice(0, trueIndex), ...commands.slice(trueIndex + 1)];
	}

	const nlIndex = commands.findIndex((command) => {
		if (command.kind !== "unknown") return false;
		const tokens = shellSplit(command.command);
		return (
			tokens[0] === "nl" &&
			tokens.slice(1).every((token) => token.startsWith("-"))
		);
	});
	if (nlIndex !== -1) {
		return [...commands.slice(0, nlIndex), ...commands.slice(nlIndex + 1)];
	}

	return undefined;
}

function dropSmallFormattingCommands(commands: string[][]): string[][] {
	return commands.filter((command) => !isSmallFormattingCommand(command));
}

export function isAbsolutePathLike(path: string): boolean {
	return isAbsoluteLike(path);
}
