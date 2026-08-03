import { awkDataFileOperand, sedReadPath } from "./command-operands.ts";

export function isSmallFormattingCommand(tokens: string[]): boolean {
	if (tokens.length === 0) return false;
	const command = tokens[0]!;
	if (
		command === "wc" ||
		command === "tr" ||
		command === "cut" ||
		command === "sort" ||
		command === "uniq" ||
		command === "tee" ||
		command === "column" ||
		command === "yes" ||
		command === "printf"
	) {
		return true;
	}
	if (command === "xargs") return !isMutatingXargsCommand(tokens);
	if (command === "awk")
		return awkDataFileOperand(tokens.slice(1)) === undefined;
	if (command === "head") {
		if (tokens.length === 1) return true;
		if (tokens.length === 2) return tokens[1]!.startsWith("-");
		if (
			tokens.length === 3 &&
			(tokens[1] === "-n" || tokens[1] === "-c") &&
			/^[0-9]+$/.test(tokens[2]!)
		)
			return true;
		return false;
	}
	if (command === "tail") {
		if (tokens.length === 1) return true;
		if (tokens.length === 2) return tokens[1]!.startsWith("-");
		if (tokens.length === 3 && (tokens[1] === "-n" || tokens[1] === "-c")) {
			const value = tokens[2]!.startsWith("+")
				? tokens[2]!.slice(1)
				: tokens[2]!;
			return value.length > 0 && /^[0-9]+$/.test(value);
		}
		return false;
	}
	if (command === "sed") return sedReadPath(tokens.slice(1)) === undefined;
	return false;
}

function isMutatingXargsCommand(tokens: string[]): boolean {
	const subcommand = xargsSubcommand(tokens);
	return subcommand?.length ? xargsIsMutatingSubcommand(subcommand) : false;
}

function xargsSubcommand(tokens: string[]): string[] | undefined {
	if (tokens[0] !== "xargs") return undefined;
	let index = 1;
	while (index < tokens.length) {
		const token = tokens[index]!;
		if (token === "--") return tokens.slice(index + 1);
		if (!token.startsWith("-")) return tokens.slice(index);
		const takesValue =
			token === "-E" ||
			token === "-e" ||
			token === "-I" ||
			token === "-L" ||
			token === "-n" ||
			token === "-P" ||
			token === "-s";
		index += takesValue && token.length === 2 ? 2 : 1;
	}
	return undefined;
}

function xargsIsMutatingSubcommand(tokens: string[]): boolean {
	const [head, ...tail] = tokens;
	if (!head) return false;
	if (head === "perl" || head === "ruby") return xargsHasInPlaceFlag(tail);
	if (head === "sed")
		return xargsHasInPlaceFlag(tail) || tail.includes("--in-place");
	if (head === "rg") return tail.includes("--replace");
	return false;
}

function xargsHasInPlaceFlag(tokens: string[]): boolean {
	return tokens.some(
		(token) =>
			token === "-i" ||
			token.startsWith("-i") ||
			token === "-pi" ||
			token.startsWith("-pi"),
	);
}
