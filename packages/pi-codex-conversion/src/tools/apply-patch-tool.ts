import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { executePatch } from "../patch/core.ts";
import { ExecutePatchError, type ExecutePatchResult } from "../patch/types.ts";
import { formatApplyPatchSummary, formatPatchTarget, renderApplyPatchCall } from "./apply-patch-rendering.ts";

const APPLY_PATCH_PARAMETERS = Type.Object({
	input: Type.String({
		description: "Full patch text. Use *** Begin Patch / *** End Patch with Add/Update/Delete File sections.",
	}),
});

interface ApplyPatchRenderState {
	cwd: string;
	patchText: string;
	collapsed: string;
	expanded: string;
	status: "pending" | "partial_failure" | "failed";
	failedTargets?: string[] | undefined;
}

interface ApplyPatchSuccessDetails {
	status: "success";
	result: ExecutePatchResult;
}

interface ApplyPatchPartialFailureDetails {
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

type ApplyPatchToolDetails = ApplyPatchSuccessDetails | ApplyPatchPartialFailureDetails;

const applyPatchRenderStates = new Map<string, ApplyPatchRenderState>();

interface ApplyPatchRenderContextLike {
	toolCallId?: string | undefined;
	cwd?: string | undefined;
	expanded?: boolean | undefined;
	argsComplete?: boolean | undefined;
}

function parseApplyPatchParams(params: unknown): { patchText: string } {
	if (!params || typeof params !== "object" || !("input" in params) || typeof params.input !== "string") {
		throw new Error("apply_patch requires a string 'input' parameter");
	}
	return { patchText: params.input };
}

function prepareApplyPatchArguments(args: unknown): { input: string } {
	if (args && typeof args === "object") {
		if ("input" in args && typeof args.input === "string") {
			return { input: args.input };
		}
		if ("patchText" in args && typeof args.patchText === "string") {
			return { input: args.patchText };
		}
		if ("patch" in args && typeof args.patch === "string") {
			return { input: args.patch };
		}
	}
	return args as { input: string };
}

function isApplyPatchToolDetails(details: unknown): details is ApplyPatchToolDetails {
	return typeof details === "object" && details !== null && "status" in details && "result" in details;
}

function setApplyPatchRenderState(
	toolCallId: string,
	patchText: string,
	cwd: string,
	status: "pending" | "partial_failure" | "failed" = "pending",
	failedTargets?: string[],
): void {
	const collapsed = formatApplyPatchSummary(patchText, cwd);
	const expanded = renderApplyPatchCall(patchText, cwd);
	applyPatchRenderStates.set(toolCallId, {
		cwd,
		patchText,
		collapsed,
		expanded,
		status,
		failedTargets,
	});
}

function markApplyPatchPartialFailure(toolCallId: string, failedTargets?: string[]): void {
	markApplyPatchFailure(toolCallId, "partial_failure", failedTargets);
}

function markApplyPatchFailure(toolCallId: string, status: "partial_failure" | "failed", failedTargets?: string[]): void {
	const existing = applyPatchRenderStates.get(toolCallId);
	if (!existing) {
		return;
	}
	applyPatchRenderStates.set(toolCallId, {
		...existing,
		status,
		failedTargets,
	});
}

function renderPartialFailureCall(
	text: string,
	theme: { fg(role: string, text: string): string },
	failedTargets?: string[],
): string {
	const lines = text.split("\n");
	if (lines.length === 0) {
		return theme.fg("warning", "• Edit partially failed");
	}
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
	return lines
		.map((line, index) => {
			if (failedLineIndexes.has(index)) {
				return theme.fg("error", line);
			}
			if (index === 0) {
				return theme.fg("warning", line);
			}
			return line;
		})
		.join("\n");
}

function renderFailedCall(
	text: string,
	theme: { fg(role: string, text: string): string },
	failedTargets?: string[],
): string {
	const lines = text.split("\n");
	if (lines.length === 0) {
		return theme.fg("error", "• Edit failed");
	}
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
	return lines
		.map((line, index) => {
			if (failedLineIndexes.has(index) || index === 0) {
				return theme.fg("error", line);
			}
			return line;
		})
		.join("\n");
}

function markFailedTargetLine(line: string, failedTarget: string): string | undefined {
	const suffixMatch = line.match(/ \(\+\d+ -\d+\)$/);
	if (!suffixMatch) {
		return undefined;
	}
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

function summarizePatchCounts(result: ExecutePatchResult): string {
	return [
		`changed ${result.changedFiles.length} file${result.changedFiles.length === 1 ? "" : "s"}`,
		`created ${result.createdFiles.length}`,
		`deleted ${result.deletedFiles.length}`,
		`moved ${result.movedFiles.length}`,
	].join(", ");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

function getFailedPaths(error: ExecutePatchError): string[] {
	return uniqueStrings(
		error.failures.flatMap(({ action }) => [action.path, action.type === "update" ? action.movePath : undefined]),
	);
}

function getAppliedPaths(result: ExecutePatchResult, failedFiles: string[]): string[] {
	return result.changedFiles.filter((path) => !failedFiles.includes(path));
}

function buildPartialFailureMessage(message: string, failedFiles: string[], appliedFiles: string[]): string {
	const lines = [message];
	if (failedFiles.length > 0) {
		lines.push(`Failed file${failedFiles.length === 1 ? "" : "s"}: ${failedFiles.join(", ")}`);
		lines.push(`Recovery: MUST read ${failedFiles.join(", ")} before retrying.`);
	}
	if (appliedFiles.length > 0) {
		lines.push("Earlier file actions in this patch were already applied.");
		lines.push("Recovery: MUST NOT reread other files from this patch unless a specific dependency requires it.");
	}
	return lines.join("\n");
}

function describeFailedActions(error: ExecutePatchError, cwd: string): string[] {
	return uniqueStrings(
		error.failures.map(({ action }) => formatPatchTarget(action.path, action.type === "update" ? action.movePath : undefined, cwd)),
	);
}

export type { ExecutePatchResult } from "../patch/types.ts";

export function clearApplyPatchRenderState(): void {
	applyPatchRenderStates.clear();
}

const renderApplyPatchCallWithOptionalContext: any = (
	args: { input?: unknown | undefined },
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	context?: ApplyPatchRenderContextLike,
) => {
	if (context?.argsComplete === false) {
		return new Text(`${theme.fg("dim", "•")} ${theme.bold("Patching")}`, 0, 0);
	}
	const patchText = typeof args.input === "string" ? args.input : "";
	if (patchText.trim().length === 0) {
		return new Text(`${theme.fg("dim", "•")} ${theme.bold("Patching")}`, 0, 0);
	}
	const cached = context?.toolCallId ? applyPatchRenderStates.get(context.toolCallId) : undefined;
	const cwd = context?.cwd ?? cached?.cwd;
	const effectivePatchText = cached?.patchText ?? patchText;
	const baseText = context?.expanded
		? cached?.expanded ?? renderApplyPatchCall(effectivePatchText, cwd)
		: cached?.collapsed ?? formatApplyPatchSummary(effectivePatchText, cwd);
	if (baseText.trim().length === 0) {
		if (cached?.status === "failed") {
			return new Text(theme.fg("error", "• Edit failed"), 0, 0);
		}
		return new Text(`${theme.fg("dim", "•")} ${theme.bold("Patching")}`, 0, 0);
	}
	const text =
		cached?.status === "partial_failure"
			? renderPartialFailureCall(baseText, theme, cached.failedTargets)
			: cached?.status === "failed"
				? renderFailedCall(baseText, theme, cached.failedTargets)
				: baseText;
	return new Text(text, 0, 0);
};

export function registerApplyPatchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "apply_patch",
		label: "apply_patch",
		description: "Apply a patch to create, edit, delete, or move files.",
		promptSnippet: "Edit files with a patch.",
		parameters: APPLY_PATCH_PARAMETERS,
		prepareArguments: prepareApplyPatchArguments,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("apply_patch aborted");
			}

			const typedParams = parseApplyPatchParams(params);
			setApplyPatchRenderState(toolCallId, typedParams.patchText, ctx.cwd);
			let result: ExecutePatchResult;
			try {
				result = executePatch({ cwd: ctx.cwd, patchText: typedParams.patchText });
			} catch (error) {
				if (error instanceof ExecutePatchError) {
					const partial = error.hasPartialSuccess();
					const failedTargets = describeFailedActions(error, ctx.cwd);
					const failedTargetSummary = failedTargets.join(", ");
					const prefix = partial
						? `apply_patch partially failed after ${summarizePatchCounts(error.result)}`
						: "apply_patch failed";
					const message = failedTargetSummary ? `${prefix} while patching ${failedTargetSummary}: ${error.message}` : `${prefix}: ${error.message}`;
					if (partial) {
						const failedFiles = getFailedPaths(error);
						const appliedFiles = getAppliedPaths(error.result, failedFiles);
						const recoveryMessage = buildPartialFailureMessage(message, failedFiles, appliedFiles);
						markApplyPatchPartialFailure(toolCallId, failedTargets);
						return {
							content: [{ type: "text", text: recoveryMessage }],
							details: {
								status: "partial_failure",
								result: error.result,
								error: recoveryMessage,
								failedTargets,
								appliedFiles,
								failedFiles,
								recoveryInstructions: {
									mustReadFiles: failedFiles,
									mustNotReadFiles: appliedFiles,
								},
							} satisfies ApplyPatchPartialFailureDetails,
						};
					}
					markApplyPatchFailure(toolCallId, "failed", failedTargets);
					throw new Error(message);
				}
				markApplyPatchFailure(toolCallId, "failed");
				throw error;
			}
			const summary = [
				"Applied patch successfully.",
				`Changed files: ${result.changedFiles.length}`,
				`Created files: ${result.createdFiles.length}`,
				`Deleted files: ${result.deletedFiles.length}`,
				`Moved files: ${result.movedFiles.length}`,
				`Fuzz: ${result.fuzz}`,
			].join("\n");

			return {
				content: [{ type: "text", text: summary }],
				details: {
					status: "success",
					result,
				} satisfies ApplyPatchSuccessDetails,
			};
		},
		renderCall: renderApplyPatchCallWithOptionalContext,
		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(`${theme.fg("dim", "•")} ${theme.bold("Patching")}`, 0, 0);
			}

			if (!isApplyPatchToolDetails(result.details)) {
				return new Container();
			}

			if (result.details.status === "partial_failure") {
				return new Container();
			}

			return new Container();
		},
	});
}
