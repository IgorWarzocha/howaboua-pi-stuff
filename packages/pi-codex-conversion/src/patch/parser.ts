import { normalizePatchPath } from "./paths.ts";
import { DiffError, type ParsedPatchAction, type ParserState, type PatchAction } from "./types.ts";

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
