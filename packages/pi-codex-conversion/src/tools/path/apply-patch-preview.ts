import { resolve } from "node:path";
import { formatApplyPatchCollapsedDiff, renderApplyPatchCall } from "../apply-patch/rendering.ts";

interface PathApplyPatchPreviewState {
	cwd: string;
	patchText: string;
	collapsed: string;
	expanded: string;
}

export interface PathApplyPatchPreviewInput {
	cwd: string;
	patchText: string;
}

const pathApplyPatchPreviewStates = new Map<string, PathApplyPatchPreviewState>();

export function clearPathApplyPatchPreviewStates(): void {
	pathApplyPatchPreviewStates.clear();
}

export function setPathApplyPatchPreviewState(toolCallId: string, command: string, cwd: string): void {
	const input = extractPathApplyPatchPreviewInput(command, cwd);
	if (!input) return;
	pathApplyPatchPreviewStates.set(toolCallId, {
		cwd: input.cwd,
		patchText: input.patchText,
		collapsed: formatApplyPatchCollapsedDiff(input.patchText, input.cwd),
		expanded: renderApplyPatchCall(input.patchText, input.cwd),
	});
}

export function renderPathApplyPatchPreviewFromState(toolCallId: string | undefined, expanded: boolean): string | undefined {
	if (!toolCallId) return undefined;
	const state = pathApplyPatchPreviewStates.get(toolCallId);
	if (!state) return undefined;
	const text = expanded ? state.expanded : state.collapsed;
	return text.trim().length > 0 ? text : undefined;
}

export function extractPathApplyPatchPreviewInput(command: string, cwd: string): PathApplyPatchPreviewInput | undefined {
	return extractHeredocApplyPatchInput(command, cwd) ?? extractArgumentApplyPatchInput(command, cwd);
}

function extractHeredocApplyPatchInput(command: string, cwd: string): PathApplyPatchPreviewInput | undefined {
	const lines = command.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const parsed = parseApplyPatchHeredocLine(lines[index]!);
		if (!parsed) continue;
		const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
		if (endIndex === -1) return undefined;
		const bodyLines = lines.slice(index + 1, endIndex);
		const patchText = parsed.stripLeadingTabs
			? bodyLines.map((line) => line.replace(/^\t+/, "")).join("\n")
			: bodyLines.join("\n");
		return { cwd: parsed.cdPath ? resolve(cwd, parsed.cdPath) : cwd, patchText };
	}
	return undefined;
}

function parseApplyPatchHeredocLine(line: string): { delimiter: string; cdPath?: string | undefined; stripLeadingTabs: boolean } | undefined {
	const match = line.match(/^\s*(?:(?:cd\s+("[^"]+"|'[^']+'|[^&;\s]+)\s*&&\s*)?)(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*)?(?:[^\s;&|()]+\/)?apply_patch\s+<<(-?)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*$/);
	if (!match) return undefined;
	const cdPath = match[1] ? unquoteShellToken(match[1]) : undefined;
	const delimiter = match[3] ?? match[4] ?? match[5];
	if (!delimiter) return undefined;
	return { delimiter, cdPath, stripLeadingTabs: match[2] === "-" };
}

function findHeredocEnd(lines: string[], startIndex: number, delimiter: string, stripLeadingTabs: boolean): number {
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = stripLeadingTabs ? lines[index]!.replace(/^\t+/, "") : lines[index]!;
		if (line === delimiter) return index;
	}
	return -1;
}

function extractArgumentApplyPatchInput(command: string, cwd: string): PathApplyPatchPreviewInput | undefined {
	const match = command.match(/^\s*(?:(?:cd\s+("[^"]+"|'[^']+'|[^&;\s]+)\s*&&\s*)?)(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*)?(?:[^\s;&|()]+\/)?apply_patch\s+([\s\S]+?)\s*$/);
	if (!match) return undefined;
	const cdPath = match[1] ? unquoteShellToken(match[1]) : undefined;
	const patchText = unquoteShellToken(match[2]!.trim());
	if (!patchText.startsWith("*** Begin Patch")) return undefined;
	return { cwd: cdPath ? resolve(cwd, cdPath) : cwd, patchText };
}

function unquoteShellToken(token: string): string {
	if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
		return token.slice(1, -1);
	}
	return token;
}
