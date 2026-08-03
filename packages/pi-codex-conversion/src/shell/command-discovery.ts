import {
	firstNonFlagOperand,
	parseFdQueryAndPath,
	parseFindQueryAndPath,
	skipFlagValues,
	trimAtConnector,
} from "./command-operands.ts";
import {
	listCommand,
	type ParsedShellCommand,
	searchCommand,
	unknownCommand,
} from "./parsed-command.ts";
import { joinCommandTokens } from "./tokenize.ts";

export function summarizeDiscoveryCommand(
	head: string,
	tail: string[],
	mainCommand: string[],
): ParsedShellCommand | undefined {
	if (head === "ls" || head === "eza" || head === "exa") {
		const flagsWithValues =
			head === "ls"
				? [
						"-I",
						"-w",
						"--block-size",
						"--format",
						"--time-style",
						"--color",
						"--quoting-style",
					]
				: [
						"-I",
						"--ignore-glob",
						"--color",
						"--sort",
						"--time-style",
						"--time",
					];
		return listCommand(mainCommand, firstNonFlagOperand(tail, flagsWithValues));
	}
	if (head === "tree") {
		return listCommand(
			mainCommand,
			firstNonFlagOperand(tail, [
				"-L",
				"-P",
				"-I",
				"--charset",
				"--filelimit",
				"--sort",
			]),
		);
	}
	if (head === "du") {
		return listCommand(
			mainCommand,
			firstNonFlagOperand(tail, [
				"-d",
				"--max-depth",
				"-B",
				"--block-size",
				"--exclude",
				"--time-style",
			]),
		);
	}
	if (head === "rg" || head === "rga" || head === "ripgrep-all") {
		const args = trimAtConnector(tail);
		const hasFilesFlag = args.includes("--files");
		const candidates = skipFlagValues(args, [
			"-g",
			"--glob",
			"--iglob",
			"-t",
			"--type",
			"--type-add",
			"--type-not",
			"-m",
			"--max-count",
			"-A",
			"-B",
			"-C",
			"--context",
			"--max-depth",
		]);
		const nonFlags = candidates.filter((token) => !token.startsWith("-"));
		if (hasFilesFlag) return listCommand(mainCommand, nonFlags[0]);
		return searchCommand(mainCommand, nonFlags[0]!, nonFlags[1]);
	}
	if (head === "git") {
		const [subcommand, ...subtail] = tail;
		if (subcommand === "grep") return parseGrepLike(mainCommand, subtail);
		if (subcommand === "ls-files") {
			return listCommand(
				mainCommand,
				firstNonFlagOperand(subtail, [
					"--exclude",
					"--exclude-from",
					"--pathspec-from-file",
				]),
			);
		}
		return unknownCommand(mainCommand);
	}
	if (head === "fd") {
		const [query, path] = parseFdQueryAndPath(tail);
		return query
			? { kind: "search", command: joinCommandTokens(mainCommand), query, path }
			: { kind: "list", command: joinCommandTokens(mainCommand), path };
	}
	if (head === "find") {
		const [query, path] = parseFindQueryAndPath(tail);
		return query
			? { kind: "search", command: joinCommandTokens(mainCommand), query, path }
			: { kind: "list", command: joinCommandTokens(mainCommand), path };
	}
	if (head === "grep" || head === "egrep" || head === "fgrep")
		return parseGrepLike(mainCommand, tail);
	if (head === "ag" || head === "ack" || head === "pt") {
		const args = trimAtConnector(tail);
		const candidates = skipFlagValues(args, [
			"-G",
			"-g",
			"--file-search-regex",
			"--ignore-dir",
			"--ignore-file",
			"--path-to-ignore",
		]);
		const nonFlags = candidates.filter((token) => !token.startsWith("-"));
		return searchCommand(mainCommand, nonFlags[0]!, nonFlags[1]);
	}
	return undefined;
}

function parseGrepLike(
	mainCommand: string[],
	args: string[],
): ParsedShellCommand {
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
			if (!pattern) pattern = trimmed[index + 1]!;
			index += 1;
			continue;
		}
		if (arg === "-f" || arg === "--file") {
			if (!pattern) pattern = trimmed[index + 1]!;
			index += 1;
			continue;
		}
		if (
			arg === "-m" ||
			arg === "--max-count" ||
			arg === "-C" ||
			arg === "--context" ||
			arg === "-A" ||
			arg === "--after-context" ||
			arg === "-B" ||
			arg === "--before-context"
		) {
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		operands.push(arg);
	}
	const hasPattern = pattern !== undefined;
	const query = pattern ?? operands[0]!;
	const pathIndex = hasPattern ? 0 : 1;
	return searchCommand(mainCommand, query, operands[pathIndex]);
}
