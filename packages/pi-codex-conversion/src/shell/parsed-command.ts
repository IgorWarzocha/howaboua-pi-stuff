import { joinCommandTokens, shortDisplayPath } from "./tokenize.ts";

export type ParsedShellCommand =
	| { kind: "read"; command: string; name: string; path: string }
	| { kind: "list"; command: string; path?: string | undefined }
	| {
			kind: "search";
			command: string;
			query?: string | undefined;
			path?: string | undefined;
	  }
	| { kind: "unknown"; command: string };

export function unknownCommand(mainCommand: string[]): ParsedShellCommand {
	return { kind: "unknown", command: joinCommandTokens(mainCommand) };
}

export function listCommand(
	mainCommand: string[],
	path: string | undefined,
): ParsedShellCommand {
	return {
		kind: "list",
		command: joinCommandTokens(mainCommand),
		path: path ? shortDisplayPath(path) : undefined,
	};
}

export function pathlessListCommand(mainCommand: string[]): ParsedShellCommand {
	return { kind: "list", command: joinCommandTokens(mainCommand) };
}

export function searchCommand(
	mainCommand: string[],
	query: string,
	path: string | undefined,
): ParsedShellCommand {
	return {
		kind: "search",
		command: joinCommandTokens(mainCommand),
		query,
		path: path ? shortDisplayPath(path) : undefined,
	};
}

export function readCommand(
	mainCommand: string[],
	path: string,
): ParsedShellCommand {
	return {
		kind: "read",
		command: joinCommandTokens(mainCommand),
		name: shortDisplayPath(path),
		path,
	};
}

export function readOrUnknown(
	mainCommand: string[],
	path: string | undefined,
): ParsedShellCommand {
	return path ? readCommand(mainCommand, path) : unknownCommand(mainCommand);
}
