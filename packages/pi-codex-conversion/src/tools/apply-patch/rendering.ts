import { buildFilePreviews, type PreviewLine } from "./patch-preview.ts";
import { isAbsolute, relative } from "node:path";
import { keyHint, renderDiff } from "@earendil-works/pi-coding-agent";
import { parsePatchActions } from "../../patch/parser.ts";
import type { ParsedPatchAction } from "../../patch/types.ts";

function expandHint(): string {
	try {
		return keyHint("app.tools.expand", "to expand");
	} catch {
		return "ctrl+o to expand";
	}
}

export function formatApplyPatchSummary(patchText: string, cwd = process.cwd()): string {
	let actions: ParsedPatchAction[];
	try {
		actions = parsePatchActions({ text: patchText });
	} catch {
		return "";
	}

	const files = buildFilePreviews(actions, cwd);
	if (files.length === 0) {
		return "";
	}

	const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
	const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
	const lines: string[] = [];

	if (files.length === 1) {
		const file = files[0]!;
		lines.push(`${bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd))} ${renderCounts(file.added, file.removed)}`);
		return lines.join("\n");
	}

	lines.push(`${bulletHeader("Edited", `${files.length} files`)} ${renderCounts(totalAdded, totalRemoved)}`);
	for (const [index, file] of files.entries()) {
		const prefix = index === 0 ? "  └ " : "    ";
		lines.push(`${prefix}${formatPatchTarget(file.path, file.movePath, cwd)} ${renderCounts(file.added, file.removed)}`);
	}

	return lines.join("\n");
}

export function formatApplyPatchCollapsedDiff(patchText: string, cwd = process.cwd(), maxPreviewLines = 10): string {
	const full = renderApplyPatchCall(patchText, cwd);
	if (!full) return formatApplyPatchSummary(patchText, cwd);
	const fullLines = full.split("\n");
	const visibleLines = fullLines.slice(0, maxPreviewLines + 1);
	const remaining = fullLines.length - visibleLines.length;
	const lines = [...visibleLines];
	if (remaining > 0) {
		lines.push(`    ... (${remaining} more lines, ${expandHint()})`);
	}
	return lines.join("\n");
}

export function renderApplyPatchCall(patchText: string, cwd = process.cwd()): string {
	let actions: ParsedPatchAction[];
	try {
		actions = parsePatchActions({ text: patchText });
	} catch {
		return "";
	}

	const files = buildFilePreviews(actions, cwd);
	if (files.length === 0) {
		return "";
	}

	const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
	const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
	const lines: string[] = [];

	if (files.length === 1) {
		const file = files[0]!;
		lines.push(`${bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd))} ${renderCounts(file.added, file.removed)}`);
		lines.push(...renderPreviewLines(file.lines));
		return lines.join("\n");
	}

	lines.push(`${bulletHeader("Edited", `${files.length} files`)} ${renderCounts(totalAdded, totalRemoved)}`);
	for (const [index, file] of files.entries()) {
		if (index > 0) {
			lines.push("");
		}
		lines.push(`  └ ${formatPatchTarget(file.path, file.movePath, cwd)} ${renderCounts(file.added, file.removed)}`);
		lines.push(...renderPreviewLines(file.lines));
	}

	return lines.join("\n");
}

function formatPreviewLine(line: PreviewLine, lines: PreviewLine[]): string {
	const numberWidth = Math.max(1, ...lines.map((entry) => String(entry.lineNumber).length));
	return `    ${String(line.lineNumber).padStart(numberWidth, " ")} ${line.marker}${line.text}`;
}

function renderPreviewLines(lines: PreviewLine[]): string[] {
	if (lines.length === 0) {
		return [];
	}

	const numberWidth = Math.max(1, ...lines.map((entry) => String(entry.lineNumber).length));
	const diffText = lines
		.map((line) => `${line.marker}${String(line.lineNumber).padStart(numberWidth, " ")} ${line.text}`)
		.join("\n");
	try {
		return renderDiff(diffText)
			.split("\n")
			.map((line) => `    ${line}`);
	} catch {
		return lines.map((line) => formatPreviewLine(line, lines));
	}
}

export function formatPatchTarget(path: string, movePath: string | undefined, cwd: string): string {
	const from = displayPath(path, cwd);
	if (!movePath) {
		return from;
	}
	return `${from} → ${displayPath(movePath, cwd)}`;
}

function displayPath(path: string, cwd: string): string {
	if (!isAbsolute(path)) {
		return path;
	}

	const relativePath = relative(cwd, path);
	if (relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
		return relativePath;
	}

	return path;
}

function bulletHeader(verb: string, label: string): string {
	return `• ${verb} ${label}`;
}

function renderCounts(added: number, removed: number): string {
	return `(+${added} -${removed})`;
}
