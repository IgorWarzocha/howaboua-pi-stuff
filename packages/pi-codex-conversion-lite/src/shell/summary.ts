import { parseCommandString, type ParsedShellCommand } from "./parse-command.ts";
import type { CommandSummary, ShellAction } from "./types.ts";

export type { CommandSummary, ShellAction } from "./types.ts";

export function summarizeShellCommand(command: string): CommandSummary {
	const actions = parseCommandString(command).map(parsedToAction);
	return {
		maskAsExplored: actions.every((action) => action.kind !== "run"),
		actions,
	};
}

function parsedToAction(command: ParsedShellCommand): ShellAction {
	if (command.kind === "unknown") {
		return { kind: "run", command: command.command };
	}
	if (command.kind === "list") {
		return command.path ? { kind: "list", command: command.command, path: command.path } : { kind: "list", command: command.command };
	}
	if (command.kind === "search") {
		return {
			kind: "search",
			command: command.command,
			...(command.query ? { query: command.query } : {}),
			...(command.path ? { path: command.path } : {}),
		};
	}
	return { kind: "read", command: command.command, name: command.name, path: command.path };
}
