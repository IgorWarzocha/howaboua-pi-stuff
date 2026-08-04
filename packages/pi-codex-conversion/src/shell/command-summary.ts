import { summarizeDiscoveryCommand } from "./command-discovery.ts";
import { isPythonCommand, pythonWalksFiles } from "./command-operands.ts";
import { summarizeReadCommand } from "./command-read.ts";
import {
	type ParsedShellCommand,
	pathlessListCommand,
	unknownCommand,
} from "./parsed-command.ts";

export { isSmallFormattingCommand } from "./formatting-command.ts";

export function summarizeMainTokens(mainCommand: string[]): ParsedShellCommand {
	const [head, ...tail] = mainCommand;
	if (!head) return unknownCommand(mainCommand);

	const discovery = summarizeDiscoveryCommand(head, tail, mainCommand);
	if (discovery) return discovery;

	const read = summarizeReadCommand(head, tail, mainCommand);
	if (read) return read;

	if (isPythonCommand(head)) {
		return pythonWalksFiles(tail)
			? pathlessListCommand(mainCommand)
			: unknownCommand(mainCommand);
	}
	return unknownCommand(mainCommand);
}
