import {
	awkDataFileOperand,
	readPathFromHeadTail,
	sedReadPath,
	singleNonFlagOperand,
	skipFlagValues,
} from "./command-operands.ts";
import { type ParsedShellCommand, readOrUnknown } from "./parsed-command.ts";

export function summarizeReadCommand(
	head: string,
	tail: string[],
	mainCommand: string[],
): ParsedShellCommand | undefined {
	if (head === "cat")
		return readOrUnknown(mainCommand, singleNonFlagOperand(tail, []));
	if (head === "bat" || head === "batcat") {
		return readOrUnknown(
			mainCommand,
			singleNonFlagOperand(tail, [
				"--theme",
				"--language",
				"--style",
				"--terminal-width",
				"--tabs",
				"--line-range",
				"--map-syntax",
			]),
		);
	}
	if (head === "less") {
		return readOrUnknown(
			mainCommand,
			singleNonFlagOperand(tail, [
				"-p",
				"-P",
				"-x",
				"-y",
				"-z",
				"-j",
				"--pattern",
				"--prompt",
				"--tabs",
				"--shift",
				"--jump-target",
			]),
		);
	}
	if (head === "more")
		return readOrUnknown(mainCommand, singleNonFlagOperand(tail, []));
	if (head === "head" || head === "tail")
		return readOrUnknown(mainCommand, readPathFromHeadTail(tail, head));
	if (head === "awk")
		return readOrUnknown(mainCommand, awkDataFileOperand(tail));
	if (head === "nl") {
		const candidates = skipFlagValues(tail, ["-s", "-w", "-v", "-i", "-b"]);
		return readOrUnknown(
			mainCommand,
			candidates.find((token) => !token.startsWith("-")),
		);
	}
	if (head === "sed") return readOrUnknown(mainCommand, sedReadPath(tail));
	return undefined;
}
