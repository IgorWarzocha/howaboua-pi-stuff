import * as fs from "node:fs";
import { dirname } from "node:path";
import { linesMatch } from "./matching.ts";
import { parsePatchActions, parseUpdateFile } from "./parser.ts";
import { openFileAtPath, pathExists, removeFileAtPath, resolvePatchPath, writeFileAtPath } from "./paths.ts";
import { DiffError, ExecutePatchError, type ExecutePatchFailure, type ExecutePatchResult, type ParsedPatchAction, type ParserState, type PatchAction } from "./types.ts";

export const patchFsOps = {
	mkdirSync: fs.mkdirSync,
	writeFileSync: fs.writeFileSync,
	unlinkSync: fs.unlinkSync,
};

function buildExecutePatchResult({
	changedFiles,
	createdFiles,
	deletedFiles,
	movedFiles,
	fuzz,
}: {
	changedFiles: Set<string>;
	createdFiles: Set<string>;
	deletedFiles: Set<string>;
	movedFiles: Set<string>;
	fuzz: number;
}): ExecutePatchResult {
	return {
		changedFiles: [...changedFiles],
		createdFiles: [...createdFiles],
		deletedFiles: [...deletedFiles],
		movedFiles: [...movedFiles],
		fuzz,
	};
}

function splitFileLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	return lines;
}

function getUpdatedFile({ text, action, path }: { text: string; action: PatchAction; path: string }): string {
	if (action.type !== "update") {
		throw new DiffError(`Invalid action type for update: ${action.type}`);
	}

	const origLines = splitFileLines(text);
	const destLines: string[] = [];
	let origIndex = 0;
	let destIndex = 0;

	for (const chunk of action.chunks) {
		if (chunk.origIndex > origLines.length) {
			throw new DiffError(`_get_updated_file: ${path}: chunk.orig_index ${chunk.origIndex} > len(lines) ${origLines.length}`);
		}
		if (origIndex > chunk.origIndex) {
			throw new DiffError(`_get_updated_file: ${path}: orig_index ${origIndex} > chunk.orig_index ${chunk.origIndex}`);
		}

		destLines.push(...origLines.slice(origIndex, chunk.origIndex));
		const delta = chunk.origIndex - origIndex;
		origIndex += delta;
		destIndex += delta;

		for (const line of chunk.delLines) {
			if (!linesMatch(origLines[origIndex] ?? "", line)) {
				throw new DiffError(`_get_updated_file: ${path}: Expected ${line} but got ${origLines[origIndex]!} at line ${origIndex + 1}`);
			}
			origIndex += 1;
		}

		if (chunk.insLines.length > 0) {
			destLines.push(...chunk.insLines);
			destIndex += chunk.insLines.length;
		}
	}

	destLines.push(...origLines.slice(origIndex));
	const tailDelta = origLines.length - origIndex;
	origIndex += tailDelta;
	destIndex += tailDelta;

	if (origIndex !== origLines.length) {
		throw new DiffError(`Unexpected final orig_index for ${path}`);
	}
	if (destIndex !== destLines.length) {
		throw new DiffError(`Unexpected final dest_index for ${path}`);
	}

	if (destLines.length === 0) {
		return "";
	}

	return `${destLines.join("\n")}\n`;
}

function resolveUpdateAction({ path, text, lines }: { path: string; text: string; lines: string[] }): { action: PatchAction; fuzz: number } {
	const state: ParserState = {
		lines,
		index: 0,
		fuzz: 0,
	};
	const action = parseUpdateFile({ state, text, path });
	if (action.chunks.length === 0) {
		throw new DiffError(`Invalid patch hunk on line 2: Update file hunk for path '${path}' is empty`);
	}
	return { action, fuzz: state.fuzz };
}

function applyMove({
	cwd,
	path,
	movePath,
	content,
	changedFiles,
	createdFiles,
	deletedFiles,
	movedFiles,
}: {
	cwd: string;
	path: string;
	movePath: string;
	content: string;
	changedFiles: Set<string>;
	createdFiles: Set<string>;
	deletedFiles: Set<string>;
	movedFiles: Set<string>;
}): void {
	const fromAbsolutePath = resolvePatchPath({ cwd, patchPath: path });
	const toAbsolutePath = resolvePatchPath({ cwd, patchPath: movePath });
	const destinationExisted = pathExists({ cwd, path: movePath });

	patchFsOps.mkdirSync(dirname(toAbsolutePath), { recursive: true });
	patchFsOps.writeFileSync(toAbsolutePath, content, "utf8");
	changedFiles.add(movePath);
	if (!destinationExisted) {
		createdFiles.add(movePath);
	}

	if (fromAbsolutePath !== toAbsolutePath) {
		patchFsOps.unlinkSync(fromAbsolutePath);
		changedFiles.add(path);
		movedFiles.add(`${path} -> ${movePath}`);
		deletedFiles.add(path);
		return;
	}

	changedFiles.add(path);
	movedFiles.add(`${path} -> ${movePath}`);
}

function applyAction({
	cwd,
	action,
	changedFiles,
	createdFiles,
	deletedFiles,
	movedFiles,
}: {
	cwd: string;
	action: ParsedPatchAction;
	changedFiles: Set<string>;
	createdFiles: Set<string>;
	deletedFiles: Set<string>;
	movedFiles: Set<string>;
}): number {
	if (action.type === "delete") {
		removeFileAtPath({ cwd, path: action.path });
		changedFiles.add(action.path);
		deletedFiles.add(action.path);
		return 0;
	}

	if (action.type === "add") {
		const { created } = writeFileAtPath({
			cwd,
			path: action.path,
			content: action.newFile ?? "",
		});
		changedFiles.add(action.path);
		if (created) {
			createdFiles.add(action.path);
		}
		return 0;
	}

	if (!action.lines) {
		throw new DiffError(`Update File Error: Missing patch lines for ${action.path}`);
	}

	const originalText = openFileAtPath({ cwd, path: action.path });
	const { action: resolvedAction, fuzz } = resolveUpdateAction({
		path: action.path,
		text: originalText,
		lines: action.lines,
	});
	resolvedAction.movePath = action.movePath;
	const newContent = getUpdatedFile({ text: originalText, action: resolvedAction, path: action.path });

	if (action.movePath) {
		applyMove({
			cwd,
			path: action.path,
			movePath: action.movePath,
			content: newContent,
			changedFiles,
			createdFiles,
			deletedFiles,
			movedFiles,
		});
		return fuzz;
	}

	writeFileAtPath({ cwd, path: action.path, content: newContent });
	changedFiles.add(action.path);
	return fuzz;
}

function getActionPaths(action: ParsedPatchAction): string[] {
	return [action.path, action.type === "update" ? action.movePath : undefined].filter((path): path is string => typeof path === "string");
}

function getCanonicalActionPaths({ cwd, action }: { cwd: string; action: ParsedPatchAction }): string[] {
	return getActionPaths(action).map((path) => resolvePatchPath({ cwd, patchPath: path }));
}

export function executePatch({ cwd, patchText }: { cwd: string; patchText: string }): ExecutePatchResult {
	if (!patchText.startsWith("*** Begin Patch")) {
		throw new DiffError("Patch must start with '*** Begin Patch'");
	}

	const actions = parsePatchActions({ text: patchText });
	const changedFiles = new Set<string>();
	const createdFiles = new Set<string>();
	const deletedFiles = new Set<string>();
	const movedFiles = new Set<string>();
	const blockedPaths = new Set<string>();
	const failures: ExecutePatchFailure[] = [];
	let fuzz = 0;

	for (const action of actions) {
		const actionPaths = getActionPaths(action);
		const canonicalActionPaths = getCanonicalActionPaths({ cwd, action });
		const overlappingPaths = canonicalActionPaths.filter((path) => blockedPaths.has(path));
		if (overlappingPaths.length > 0) {
			failures.push({
				action,
				message: `Skipped because an earlier failed action affected ${actionPaths.filter((_, index) => overlappingPaths.includes(canonicalActionPaths[index]!)).join(", ")}`,
			});
			continue;
		}

		try {
			fuzz += applyAction({
				cwd,
				action,
				changedFiles,
				createdFiles,
				deletedFiles,
				movedFiles,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			for (const path of canonicalActionPaths) {
				blockedPaths.add(path);
			}
			failures.push({ action, message });
		}
	}

	if (failures.length > 0) {
		const message =
			failures.length === 1
				? failures[0]!.message
				: failures.map(({ action, message: failureMessage }) => `${action.path}: ${failureMessage}`).join("\n");
		throw new ExecutePatchError(
			message,
			buildExecutePatchResult({
				changedFiles,
				createdFiles,
				deletedFiles,
				movedFiles,
				fuzz,
			}),
			failures,
		);
	}

	return buildExecutePatchResult({
		changedFiles,
		createdFiles,
		deletedFiles,
		movedFiles,
		fuzz,
	});
}
