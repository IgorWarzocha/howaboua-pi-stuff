import { resolve } from "node:path";
import { formatApplyPatchCollapsedDiff, formatApplyPatchSummary, renderApplyPatchCall } from "../apply-patch/rendering.ts";

export interface PathApplyPatchPreviewInput {
	cwd: string;
	patchText: string;
	beforeCommand?: string | undefined;
	afterCommand?: string | undefined;
}

export type PathApplyPatchRenderSegment =
	| { kind: "command"; command: string }
	| { kind: "patch"; cwd: string; patchText: string; summary: string; collapsed: string; expanded: string };

export interface PathApplyPatchRenderState {
	segments: PathApplyPatchRenderSegment[];
	exitCode?: number | undefined;
}

export interface PathApplyPatchPreviewPlan {
	segments: PathApplyPatchRenderSegment[];
}

const pathApplyPatchPreviewStates = new Map<string, PathApplyPatchRenderState>();

export function clearPathApplyPatchPreviewStates(): void {
	pathApplyPatchPreviewStates.clear();
}

export function setPathApplyPatchPreviewState(toolCallId: string, command: string, cwd: string): void {
	const plan = extractPathApplyPatchPreviewPlan(command, cwd);
	if (!plan) return;
	pathApplyPatchPreviewStates.set(toolCallId, { segments: plan.segments });
}

export function getPathApplyPatchRenderState(toolCallId: string | undefined): PathApplyPatchRenderState | undefined {
	if (!toolCallId) return undefined;
	return pathApplyPatchPreviewStates.get(toolCallId);
}

export function markPathApplyPatchPreviewExit(toolCallId: string, exitCode: number | undefined): void {
	const state = pathApplyPatchPreviewStates.get(toolCallId);
	if (!state) return;
	state.exitCode = exitCode;
}

export function renderPathApplyPatchPreviewFromState(toolCallId: string | undefined, expanded: boolean): string | undefined {
	const state = getPathApplyPatchRenderState(toolCallId);
	if (!state) return undefined;
	const text = state.segments
		.filter((segment) => segment.kind === "patch")
		.map((segment) => expanded ? segment.expanded : segment.collapsed)
		.filter((value) => value.trim().length > 0)
		.join("\n");
	return text.trim().length > 0 ? text : undefined;
}

export function extractPathApplyPatchPreviewPlan(command: string, cwd: string): PathApplyPatchPreviewPlan | undefined {
	return extractHeredocApplyPatchPlan(command, cwd) ?? extractArgumentApplyPatchPlan(command, cwd);
}

export function extractPathApplyPatchPreviewInput(command: string, cwd: string): PathApplyPatchPreviewInput | undefined {
	return extractHeredocApplyPatchInput(command, cwd) ?? extractArgumentApplyPatchInput(command, cwd);
}

function extractHeredocApplyPatchPlan(command: string, cwd: string): PathApplyPatchPreviewPlan | undefined {
	const lines = command.split(/\r?\n/);
	const segments: PathApplyPatchRenderSegment[] = [];
	let commandStartIndex = 0;
	let foundPatch = false;

	for (let index = 0; index < lines.length; index += 1) {
		const parsed = parseApplyPatchHeredocLine(lines[index]!);
		if (!parsed) continue;
		const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
		if (endIndex === -1) return undefined;
		const commandBeforePatch = cleanCommand(lines.slice(commandStartIndex, index).join("\n"));
		if (hasDanglingConnector(commandBeforePatch)) return undefined;
		if (commandBeforePatch) segments.push({ kind: "command", command: commandBeforePatch });
		const bodyLines = lines.slice(index + 1, endIndex);
		const patchText = parsed.stripLeadingTabs
			? bodyLines.map((line) => line.replace(/^\t+/, "")).join("\n")
			: bodyLines.join("\n");
		const patchCwd = parsed.cdPath ? resolve(cwd, parsed.cdPath) : cwd;
		segments.push({
			kind: "patch",
			cwd: patchCwd,
			patchText,
			summary: formatApplyPatchSummary(patchText, patchCwd),
			collapsed: formatApplyPatchCollapsedDiff(patchText, patchCwd),
			expanded: renderApplyPatchCall(patchText, patchCwd),
		});
		foundPatch = true;
		commandStartIndex = endIndex + 1;
		index = endIndex;
	}

	if (!foundPatch) return undefined;
	const remainingCommand = cleanCommand(lines.slice(commandStartIndex).join("\n"));
	if (remainingCommand) segments.push({ kind: "command", command: remainingCommand });
	return { segments };
}

function extractArgumentApplyPatchPlan(command: string, cwd: string): PathApplyPatchPreviewPlan | undefined {
	const input = extractArgumentApplyPatchInput(command, cwd);
	if (!input) return undefined;
	return {
		segments: [{
			kind: "patch",
			cwd: input.cwd,
			patchText: input.patchText,
			summary: formatApplyPatchSummary(input.patchText, input.cwd),
			collapsed: formatApplyPatchCollapsedDiff(input.patchText, input.cwd),
			expanded: renderApplyPatchCall(input.patchText, input.cwd),
		}],
	};
}

function extractHeredocApplyPatchInput(command: string, cwd: string): PathApplyPatchPreviewInput | undefined {
	const lines = command.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const parsed = parseApplyPatchHeredocLine(lines[index]!);
		if (!parsed) continue;
		const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
		if (endIndex === -1) return undefined;
		const beforeCommand = cleanCommand(lines.slice(0, index).join("\n"));
		if (hasDanglingConnector(beforeCommand)) return undefined;
		const bodyLines = lines.slice(index + 1, endIndex);
		const patchText = parsed.stripLeadingTabs
			? bodyLines.map((line) => line.replace(/^\t+/, "")).join("\n")
			: bodyLines.join("\n");
		return {
			cwd: parsed.cdPath ? resolve(cwd, parsed.cdPath) : cwd,
			patchText,
			beforeCommand,
			afterCommand: cleanCommand(lines.slice(endIndex + 1).join("\n")),
		};
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

function cleanCommand(command: string): string | undefined {
	const trimmed = command.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function hasDanglingConnector(command: string | undefined): boolean {
	return Boolean(command && /(?:&&|\|\||\|)\s*$/.test(command));
}

function unquoteShellToken(token: string): string {
	if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
		return token.slice(1, -1);
	}
	return token;
}
