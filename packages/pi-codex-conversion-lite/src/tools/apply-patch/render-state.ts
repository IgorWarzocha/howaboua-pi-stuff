import type { ExecutePatchResult } from "../../patch/types.ts";
import { formatApplyPatchCollapsedDiff, formatApplyPatchSummary, renderApplyPatchCall } from "./rendering.ts";

interface ApplyPatchRenderState {
	cwd: string;
	patchText: string;
	collapsed: string;
	collapsedDiff: string;
	expanded: string;
	status: "pending" | "partial_failure" | "failed";
	failedTargets?: string[] | undefined;
}

export interface ApplyPatchSuccessDetails {
	status: "success";
	result: ExecutePatchResult;
}

export interface ApplyPatchPartialFailureDetails {
	status: "partial_failure";
	result: ExecutePatchResult;
	error: string;
	failedTargets?: string[] | undefined;
	appliedFiles: string[];
	failedFiles: string[];
	recoveryInstructions: {
		mustReadFiles: string[];
		mustNotReadFiles: string[];
	};
}

export type ApplyPatchToolDetails = ApplyPatchSuccessDetails | ApplyPatchPartialFailureDetails;

const applyPatchRenderStates = new Map<string, ApplyPatchRenderState>();

export function isApplyPatchToolDetails(details: unknown): details is ApplyPatchToolDetails {
	return typeof details === "object" && details !== null && "status" in details && "result" in details;
}

export function clearApplyPatchRenderState(): void {
	applyPatchRenderStates.clear();
}

export function setApplyPatchRenderState(
	toolCallId: string,
	patchText: string,
	cwd: string,
	status: "pending" | "partial_failure" | "failed" = "pending",
	failedTargets?: string[],
): void {
	const collapsed = formatApplyPatchSummary(patchText, cwd);
	const collapsedDiff = formatApplyPatchCollapsedDiff(patchText, cwd);
	const expanded = renderApplyPatchCall(patchText, cwd);
	applyPatchRenderStates.set(toolCallId, { cwd, patchText, collapsed, collapsedDiff, expanded, status, failedTargets });
}

export function markApplyPatchPartialFailure(toolCallId: string, failedTargets?: string[]): void {
	markApplyPatchFailure(toolCallId, "partial_failure", failedTargets);
}

export function markApplyPatchFailure(toolCallId: string, status: "partial_failure" | "failed", failedTargets?: string[]): void {
	const existing = applyPatchRenderStates.get(toolCallId);
	if (!existing) return;
	applyPatchRenderStates.set(toolCallId, { ...existing, status, failedTargets });
}

function markFailedTargetLine(line: string, failedTarget: string): string | undefined {
	const suffixMatch = line.match(/ \(\+\d+ -\d+\)$/);
	if (!suffixMatch) return undefined;
	const suffix = suffixMatch[0]!;
	const prefixAndTarget = line.slice(0, -suffix.length);
	const candidatePrefixes = ["• Edit partially failed ", "• Added ", "• Edited ", "• Deleted ", "  └ ", "    "];
	for (const prefix of candidatePrefixes) {
		if (prefixAndTarget === `${prefix}${failedTarget}`) {
			return `${prefix}${failedTarget} failed${suffix}`;
		}
	}
	return undefined;
}

function renderPartialFailureCall(text: string, theme: { fg(role: string, text: string): string }, failedTargets?: string[]): string {
	const lines = text.split("\n");
	if (lines.length === 0) return theme.fg("warning", "• Edit partially failed");
	lines[0] = lines[0]!.replace(/^• (Added|Edited|Deleted)\b/, "• Edit partially failed");
	const failedLineIndexes = new Set<number>();
	if (failedTargets) {
		for (let i = 0; i < lines.length; i += 1) {
			for (const failedTarget of failedTargets) {
				const failedLine = markFailedTargetLine(lines[i]!, failedTarget);
				if (failedLine) {
					lines[i] = failedLine;
					failedLineIndexes.add(i);
					break;
				}
			}
		}
	}
	return lines.map((line, index) => {
		if (failedLineIndexes.has(index)) return theme.fg("error", line);
		if (index === 0) return theme.fg("warning", line);
		return line;
	}).join("\n");
}

function renderFailedCall(text: string, theme: { fg(role: string, text: string): string }, failedTargets?: string[]): string {
	const lines = text.split("\n");
	if (lines.length === 0) return theme.fg("error", "• Edit failed");
	lines[0] = lines[0]!.replace(/^• (Added|Edited|Deleted)\b/, "• Edit failed");
	const failedLineIndexes = new Set<number>();
	if (failedTargets) {
		for (let i = 0; i < lines.length; i += 1) {
			for (const failedTarget of failedTargets) {
				const failedLine = markFailedTargetLine(lines[i]!, failedTarget);
				if (failedLine) {
					lines[i] = failedLine;
					failedLineIndexes.add(i);
					break;
				}
			}
		}
	}
	return lines.map((line, index) => failedLineIndexes.has(index) || index === 0 ? theme.fg("error", line) : line).join("\n");
}

export function renderApplyPatchCallFromState(args: { input?: unknown | undefined }, theme: { fg(role: string, text: string): string; bold(text: string): string }, context?: { toolCallId?: string | undefined; cwd?: string | undefined; expanded?: boolean | undefined; argsComplete?: boolean | undefined; showCollapsedDiff?: boolean | undefined }): string {
	if (context?.argsComplete === false) return `${theme.fg("dim", "•")} ${theme.bold("Patching")}`;
	const patchText = typeof args.input === "string" ? args.input : "";
	if (patchText.trim().length === 0) return `${theme.fg("dim", "•")} ${theme.bold("Patching")}`;
	const cached = context?.toolCallId ? applyPatchRenderStates.get(context.toolCallId) : undefined;
	const cwd = context?.cwd ?? cached?.cwd;
	const effectivePatchText = cached?.patchText ?? patchText;
	const baseText = context?.expanded
		? cached?.expanded ?? renderApplyPatchCall(effectivePatchText, cwd)
		: context?.showCollapsedDiff
			? cached?.collapsedDiff ?? formatApplyPatchCollapsedDiff(effectivePatchText, cwd)
		: cached?.collapsed ?? formatApplyPatchSummary(effectivePatchText, cwd);
	if (baseText.trim().length === 0) {
		if (cached?.status === "failed") return theme.fg("error", "• Edit failed");
		return `${theme.fg("dim", "•")} ${theme.bold("Patching")}`;
	}
	return cached?.status === "partial_failure"
		? renderPartialFailureCall(baseText, theme, cached.failedTargets)
		: cached?.status === "failed"
			? renderFailedCall(baseText, theme, cached.failedTargets)
			: baseText;
}
