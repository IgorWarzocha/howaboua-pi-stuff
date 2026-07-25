import { lineMatchFuzz, linesEqualFuzz } from "./matching.ts";
import { normalizePatchPath } from "./paths.ts";
import { DiffError, type Chunk, type ParseMode, type ParsedPatchAction, type ParserState, type PatchAction } from "./types.ts";

function parserIsDone({ state, prefixes }: { state: ParserState; prefixes?: string[] | undefined }): boolean {
	if (state.index >= state.lines.length) {
		return true;
	}
	if (prefixes && prefixes.some((prefix) => state.lines[state.index]!.startsWith(prefix))) {
		return true;
	}
	return false;
}

function parserReadStr({
	state,
	prefix,
	returnEverything,
}: {
	state: ParserState;
	prefix?: string | undefined;
	returnEverything?: boolean | undefined;
}): string {
	if (state.index >= state.lines.length) {
		throw new DiffError(`Index: ${state.index} >= ${state.lines.length}`);
	}

	const expectedPrefix = prefix ?? "";
	if (state.lines[state.index]!.startsWith(expectedPrefix)) {
		const text = returnEverything ? state.lines[state.index]! : state.lines[state.index]!.slice(expectedPrefix.length);
		state.index += 1;
		return text;
	}
	return "";
}

function splitFileLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	return lines;
}

function findContextCore({ lines, context, start }: { lines: string[]; context: string[]; start: number }): {
	newIndex: number;
	fuzz: number;
} {
	if (context.length === 0) {
		return { newIndex: start, fuzz: 0 };
	}

	for (const tier of [0, 1, 100]) {
		for (let index = start; index <= lines.length - context.length; index++) {
			const quality = linesEqualFuzz({ left: lines.slice(index, index + context.length), right: context });
			if (quality?.worstLineFuzz === tier) {
				return { newIndex: index, fuzz: quality.fuzz };
			}
		}
	}

	return { newIndex: -1, fuzz: 0 };
}

function findSectionAnchor({ lines, target, start }: { lines: string[]; target: string; start: number }): { newIndex: number; fuzz: number } {
	for (const tier of [0, 1, 100]) {
		const alreadySeen = lines.slice(0, start).some((line) => lineMatchFuzz(line, target) === tier);
		if (alreadySeen) {
			continue;
		}

		for (let index = start; index < lines.length; index++) {
			const fuzz = lineMatchFuzz(lines[index]!, target);
			if (fuzz === tier) {
				return { newIndex: index, fuzz };
			}
		}
	}

	return { newIndex: -1, fuzz: 0 };
}

function findContext({
	lines,
	context,
	start,
	eof,
}: {
	lines: string[];
	context: string[];
	start: number;
	eof: boolean;
}): { newIndex: number; fuzz: number } {
	if (eof) {
		const nearEnd = Math.max(lines.length - context.length, 0);
		const preferred = findContextCore({ lines, context, start: nearEnd });
		if (preferred.newIndex !== -1) {
			return preferred;
		}
		const fallback = findContextCore({ lines, context, start });
		return { newIndex: fallback.newIndex, fuzz: fallback.fuzz + 10000 };
	}
	return findContextCore({ lines, context, start });
}

function peekNextSection({ lines, index }: { lines: string[]; index: number }): {
	nextChunkContext: string[];
	chunks: Chunk[];
	endPatchIndex: number;
	eof: boolean;
} {
	const old: string[] = [];
	let delLines: string[] = [];
	let insLines: string[] = [];
	const chunks: Chunk[] = [];
	let mode: ParseMode = "keep";
	const origIndex = index;

	while (index < lines.length) {
		const rawLine = lines[index]!;
		if (
			rawLine.startsWith("@@") ||
			rawLine.startsWith("*** End Patch") ||
			rawLine.startsWith("*** Update File:") ||
			rawLine.startsWith("*** Delete File:") ||
			rawLine.startsWith("*** Add File:") ||
			rawLine.startsWith("*** End of File")
		) {
			break;
		}

		if (rawLine === "***") {
			break;
		}
		if (rawLine.startsWith("***")) {
			throw new DiffError(`Invalid Line: ${rawLine}`);
		}

		index += 1;
		const lastMode: ParseMode = mode;
		let line = rawLine;
		if (line === "") {
			line = " ";
		}

		if (line[0] === "+") {
			mode = "add";
		} else if (line[0] === "-") {
			mode = "delete";
		} else if (line[0] === " ") {
			mode = "keep";
		} else {
			throw new DiffError(`Invalid Line: ${line}`);
		}

		const value = line.slice(1);
		if (mode === "keep" && lastMode !== mode) {
			if (insLines.length > 0 || delLines.length > 0) {
				chunks.push({
					origIndex: old.length - delLines.length,
					delLines,
					insLines,
				});
			}
			delLines = [];
			insLines = [];
		}

		if (mode === "delete") {
			delLines.push(value);
			old.push(value);
		} else if (mode === "add") {
			insLines.push(value);
		} else {
			old.push(value);
		}
	}

	if (insLines.length > 0 || delLines.length > 0) {
		chunks.push({
			origIndex: old.length - delLines.length,
			delLines,
			insLines,
		});
	}

	if (index < lines.length && lines[index] === "*** End of File") {
		return {
			nextChunkContext: old,
			chunks,
			endPatchIndex: index + 1,
			eof: true,
		};
	}

	if (index === origIndex) {
		throw new DiffError(`Nothing in this section - index=${index} ${lines[index] ?? ""}`);
	}

	return {
		nextChunkContext: old,
		chunks,
		endPatchIndex: index,
		eof: false,
	};
}

function parseAddFile({ state }: { state: ParserState }): PatchAction {
	const lines: string[] = [];
	while (
		!parserIsDone({
			state,
			prefixes: ["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:"],
		})
	) {
		const value = parserReadStr({ state, prefix: "" });
		if (!value.startsWith("+")) {
			throw new DiffError(`Invalid Add File Line: ${value}`);
		}
		lines.push(value.slice(1));
	}

	return {
		type: "add",
		newFile: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
		chunks: [],
	};
}

export function parseUpdateFile({ state, text, path }: { state: ParserState; text: string; path: string }): PatchAction {
	const action: PatchAction = {
		type: "update",
		chunks: [],
	};

	const lines = splitFileLines(text);
	let index = 0;

	while (
		!parserIsDone({
			state,
			prefixes: ["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:", "*** End of File"],
		})
	) {
		const defStr = parserReadStr({ state, prefix: "@@ " });
		let sectionStr = "";
		if (!defStr && state.index < state.lines.length && state.lines[state.index] === "@@") {
			sectionStr = state.lines[state.index]!;
			state.index += 1;
		}

		if (!(defStr || sectionStr || index === 0)) {
			throw new DiffError(`Invalid Line:\n${state.lines[state.index]!}`);
		}

		if (defStr.trim().length > 0) {
			const sectionAnchor = findSectionAnchor({ lines, target: defStr, start: index });
			if (sectionAnchor.newIndex !== -1) {
				index = sectionAnchor.newIndex + 1;
				state.fuzz += sectionAnchor.fuzz;
			}
		}

		const { nextChunkContext, chunks, endPatchIndex, eof } = peekNextSection({ lines: state.lines, index: state.index });
		const nextChunkText = nextChunkContext.join("\n");
		const { newIndex, fuzz } = findContext({
			lines,
			context: nextChunkContext,
			start: index,
			eof,
		});

		if (newIndex === -1) {
			throw new DiffError(`Failed to find expected lines in ${path}:\n${nextChunkText}`);
		}

		state.fuzz += fuzz;

		for (const chunk of chunks) {
			action.chunks.push({
				origIndex: chunk.origIndex + newIndex,
				delLines: chunk.delLines,
				insLines: chunk.insLines,
			});
		}

		index = newIndex + nextChunkContext.length;
		state.index = endPatchIndex;
	}

	return action;
}

const VALID_HUNK_HEADERS = [
	"'*** Add File: {path}'",
	"'*** Delete File: {path}'",
	"'*** Update File: {path}'",
].join(", ");

export function parsePatchActions({ text }: { text: string }): ParsedPatchAction[] {
	const lines = text.trim().split("\n");
	if (lines.length < 2 || !lines[0]!.startsWith("*** Begin Patch") || lines[lines.length - 1] !== "*** End Patch") {
		throw new DiffError("Invalid patch text");
	}

	const actions: ParsedPatchAction[] = [];
	const seenPaths = new Set<string>();
	let index = 1;

	while (index < lines.length - 1) {
		const line = lines[index]!;
		const lineNumber = index + 1;

		if (line.startsWith("*** Update File: ")) {
			const updatePath = normalizePatchPath({ path: line.slice("*** Update File: ".length) });
			if (seenPaths.has(updatePath)) {
				throw new DiffError(`Update File Error: Duplicate Path: ${updatePath}`);
			}
			seenPaths.add(updatePath);
			index += 1;
			let movePath: string | undefined;
			if (index < lines.length - 1 && lines[index]!.startsWith("*** Move to: ")) {
				movePath = normalizePatchPath({ path: lines[index]!.slice("*** Move to: ".length) });
				index += 1;
			}
			const bodyStart = index;
			while (
				index < lines.length - 1 &&
				!lines[index]!.startsWith("*** Update File: ") &&
				!lines[index]!.startsWith("*** Delete File: ") &&
				!lines[index]!.startsWith("*** Add File: ")
			) {
				index += 1;
			}
			const bodyLines = lines.slice(bodyStart, index);
			if (bodyLines.length === 0) {
				throw new DiffError(`Invalid patch hunk on line ${lineNumber}: Update file hunk for path '${updatePath}' is empty`);
			}
			actions.push({
				type: "update",
				path: updatePath,
				movePath,
				lines: bodyLines,
			});
			continue;
		}

		if (line.startsWith("*** Delete File: ")) {
			const deletePath = normalizePatchPath({ path: line.slice("*** Delete File: ".length) });
			if (seenPaths.has(deletePath)) {
				throw new DiffError(`Delete File Error: Duplicate Path: ${deletePath}`);
			}
			seenPaths.add(deletePath);
			actions.push({
				type: "delete",
				path: deletePath,
			});
			index += 1;
			continue;
		}

		if (line.startsWith("*** Add File: ")) {
			const addPath = normalizePatchPath({ path: line.slice("*** Add File: ".length) });
			if (seenPaths.has(addPath)) {
				throw new DiffError(`Add File Error: Duplicate Path: ${addPath}`);
			}
			seenPaths.add(addPath);
			const state: ParserState = {
				lines,
				index: index + 1,
				fuzz: 0,
			};
			const action = parseAddFile({ state });
			actions.push({
				type: "add",
				path: addPath,
				newFile: action.newFile,
			});
			index = state.index;
			continue;
		}

		throw new DiffError(
			`Invalid patch hunk on line ${lineNumber}: '${line}' is not a valid hunk header. Valid hunk headers: ${VALID_HUNK_HEADERS}`,
		);
	}

	if (actions.length === 0) {
		throw new DiffError("No files were modified.");
	}

	return actions;
}
