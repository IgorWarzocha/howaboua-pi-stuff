import { obj, str } from "@earendil-works/pi-schema";
import {
	type ExtensionAPI,
	type KeybindingHints,
	type ToolDefinition,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { parsePatchActions } from "../../patch/parser.ts";
import { resolvePatchPath } from "../../patch/paths.ts";
import {
	ExecutePatchError,
	type ExecutePatchResult,
} from "../../patch/types.ts";
import { getExperimentalToolSampling } from "../tool-sampling.ts";
import {
	recordApplyPatchDisplayInput,
	recordApplyPatchDisplayOutcome,
	shouldCompactApplyPatchDisplay,
} from "./display-broker.ts";
import { formatPatchTarget } from "./rendering.ts";
import { executePatchWithRust } from "./executor.ts";
import {
	isApplyPatchToolDetails,
	markApplyPatchFailure,
	markApplyPatchPartialFailure,
	renderApplyPatchCallFromState,
	setApplyPatchRenderState,
	type ApplyPatchToolDetails,
	type ApplyPatchPartialFailureDetails,
	type ApplyPatchSuccessDetails,
} from "./render-state.ts";

const APPLY_PATCH_PARAMETERS = obj(
	{
		input: str({
			description:
				"*** Begin Patch / *** End Patch; Add/Update/Delete File sections. *** Move to: path immediately follows its Update File header; requires a nonempty @@ hunk (one unchanged context line for pure moves). Hunks MUST follow file order and MUST NOT overlap, including context; merge overlapping hunks. Indentation is literal",
		}),
	},
	{ open: true },
);

interface ApplyPatchRenderContextLike extends Partial<KeybindingHints> {
	toolCallId?: string | undefined;
	cwd?: string | undefined;
	executionStarted?: boolean | undefined;
	expanded?: boolean | undefined;
	argsComplete?: boolean | undefined;
}

type ApplyPatchToolDefinition = ToolDefinition<
	typeof APPLY_PATCH_PARAMETERS,
	ApplyPatchToolDetails
>;

export type ApplyPatchRenderCall = NonNullable<
	ApplyPatchToolDefinition["renderCall"]
>;
export type ApplyPatchRenderResult = NonNullable<
	ApplyPatchToolDefinition["renderResult"]
>;

export interface ApplyPatchToolOptions {
	customRustBinariesDir?: string | undefined;
	promptSnippet?: boolean | undefined;
	showDiffWhenCollapsed?: boolean | undefined;
	renderCall?: ApplyPatchRenderCall | undefined;
	renderResult?: ApplyPatchRenderResult | undefined;
}

function parseApplyPatchParams(params: unknown): { patchText: string } {
	if (
		!params ||
		typeof params !== "object" ||
		!("input" in params) ||
		typeof params.input !== "string"
	) {
		throw new Error("apply_patch requires a string 'input' parameter");
	}
	return { patchText: params.input };
}

function prepareApplyPatchArguments(args: unknown): { input: string } {
	if (args && typeof args === "object") {
		if ("input" in args && typeof args.input === "string")
			return { input: args.input };
		if ("patchText" in args && typeof args.patchText === "string")
			return { input: args.patchText };
		if ("patch" in args && typeof args.patch === "string")
			return { input: args.patch };
	}
	return args as { input: string };
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
	return Array.from(
		new Set(
			values.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			),
		),
	);
}

function touchedPatchPaths(cwd: string, patchText: string): string[] {
	try {
		const paths = parsePatchActions({ text: patchText }).flatMap((action) => [
			action.path,
			action.movePath,
		]);
		return [
			...new Set(
				paths
					.filter((path): path is string => !!path)
					.map((patchPath) => resolvePatchPath({ cwd, patchPath })),
			),
		].sort();
	} catch {
		// The Rust helper remains authoritative for malformed patch errors.
		return [];
	}
}

async function withTouchedFileMutationQueues<T>(
	cwd: string,
	patchText: string,
	fn: () => Promise<T>,
): Promise<T> {
	const paths = touchedPatchPaths(cwd, patchText);
	const run = (index: number): Promise<T> =>
		index >= paths.length
			? fn()
			: withFileMutationQueue(paths[index]!, () => run(index + 1));
	return run(0);
}

function buildPartialFailureMessage(
	result: ExecutePatchResult,
	failedTargetSummary: string,
	cause: string,
): string {
	const lines = [
		failedTargetSummary
			? `apply_patch partially failed while patching ${failedTargetSummary}`
			: "apply_patch partially failed",
	];
	if (result.changedFiles.length > 0) {
		lines.push(`Changed paths: ${result.changedFiles.join(", ")}`);
	}
	lines.push(
		result.fuzz > 0
			? "Change details may be incomplete. Inspect affected paths before retrying unfinished edits."
			: failedTargetSummary
				? "Later sections did not run. MUST inspect the failed target before retrying unfinished edits."
				: "Later sections did not run. Inspect the failed target before retrying unfinished edits.",
		cause,
	);
	return lines.join("\n");
}

function expectedContextPreview(cause: string): string | undefined {
	if (!cause.startsWith("Failed to find expected lines")) return undefined;
	return cause
		.split("\n")
		.slice(1)
		.find((line) => line.trim().length > 0)
		?.trim();
}

function summarizePatchCause(cause: string): string {
	const preview = expectedContextPreview(cause);
	if (preview === undefined) return cause;
	return preview
		? `${cause.split("\n", 1)[0]}\nExpected near: ${preview}`
		: cause.split("\n", 1)[0]!;
}

function addContextRecovery(
	message: string,
	cause: string,
	failedTargets: string[],
): string {
	if (expectedContextPreview(cause) === undefined) return message;
	const target = failedTargets.join(", ") || "the failed file";
	return `${message}\nRecovery: MUST read ${target} and retry only the failed edit against current contents`;
}

function describeFailedActions(
	error: ExecutePatchError,
	cwd: string,
): string[] {
	return uniqueStrings(
		error.failures.map(({ action }) =>
			formatPatchTarget(
				action.path,
				action.type === "update" ? action.movePath : undefined,
				cwd,
			),
		),
	);
}

export type { ExecutePatchResult } from "../../patch/types.ts";
export type {
	ApplyPatchPartialFailureDetails,
	ApplyPatchSuccessDetails,
	ApplyPatchToolDetails,
} from "./render-state.ts";
export {
	clearApplyPatchRenderState,
	isApplyPatchToolDetails,
} from "./render-state.ts";

const renderApplyPatchCallWithOptionalContext = (
	args: unknown,
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	context?: ApplyPatchRenderContextLike,
	options: ApplyPatchToolOptions = {},
) =>
	new Text(
		renderApplyPatchCallFromState(
			args && typeof args === "object" && "input" in args
				? { input: args.input }
				: {},
			theme,
			{ ...context, showCollapsedDiff: options.showDiffWhenCollapsed },
		),
		0,
		0,
	);

function renderCompactApplyPatchCall(theme: {
	fg(role: string, text: string): string;
	bold(text: string): string;
}): Text {
	return new Text(`${theme.fg("dim", "•")} ${theme.bold("Patching")}`, 0, 0);
}

export function createApplyPatchTool(
	options: ApplyPatchToolOptions = {},
): ApplyPatchToolDefinition {
	const constrainedSampling = getExperimentalToolSampling("apply_patch");
	const compactRendering = (context?: ApplyPatchRenderContextLike) =>
		shouldCompactApplyPatchDisplay(
			context?.toolCallId,
			context?.executionStarted,
		);
	const defaultRenderCall: ApplyPatchRenderCall = (args, theme, context) =>
		compactRendering(context)
			? renderCompactApplyPatchCall(theme)
			: renderApplyPatchCallWithOptionalContext(args, theme, context, options);
	const defaultRenderResult: ApplyPatchRenderResult = (
		result,
		{ isPartial },
		theme,
		context,
	) => {
		if (compactRendering(context)) {
			if (isPartial) return renderCompactApplyPatchCall(theme);
			if (isApplyPatchToolDetails(result.details)) {
				if (result.details.status === "partial_failure")
					return new Text(theme.fg("error", "• Patch partially failed"), 0, 0);
				return new Text(
					theme.fg(
						"dim",
						`• Applied patch (${summarizePatchCounts(result.details.result)})`,
					),
					0,
					0,
				);
			}
			if (context.isError)
				return new Text(theme.fg("error", "• Patch failed"), 0, 0);
			return new Container();
		}
		if (isPartial)
			return new Text(
				`${theme.fg("dim", "•")} ${theme.bold("Patching")}`,
				0,
				0,
			);
		if (!isApplyPatchToolDetails(result.details)) return new Container();
		if (result.details.status === "partial_failure") return new Container();
		return new Container();
	};
	return {
		name: "apply_patch",
		label: "apply_patch",
		description: "Patch files",
		...(options.promptSnippet === false
			? {}
			: { promptSnippet: "Edit files with patch" }),
		parameters: APPLY_PATCH_PARAMETERS,
		...(constrainedSampling ? { constrainedSampling } : {}),
		executionMode: "sequential",
		prepareArguments: prepareApplyPatchArguments,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("apply_patch aborted");

			const typedParams = parseApplyPatchParams(params);
			recordApplyPatchDisplayInput(toolCallId, typedParams.patchText);
			setApplyPatchRenderState(toolCallId, typedParams.patchText, ctx.cwd);
			let result: ExecutePatchResult;
			try {
				result = await withTouchedFileMutationQueues(
					ctx.cwd,
					typedParams.patchText,
					() =>
						executePatchWithRust({
							cwd: ctx.cwd,
							patchText: typedParams.patchText,
							signal,
							customRustBinariesDir: options.customRustBinariesDir,
						}),
				);
			} catch (error) {
				if (error instanceof ExecutePatchError) {
					const partial = error.hasPartialSuccess();
					const failedTargets = describeFailedActions(error, ctx.cwd);
					const failedTargetSummary = failedTargets.join(", ");
					const cause = summarizePatchCause(error.message);
					if (partial) {
						const recoveryMessage = buildPartialFailureMessage(
							error.result,
							failedTargetSummary,
							cause,
						);
						markApplyPatchPartialFailure(toolCallId, failedTargets);
						const details = {
							status: "partial_failure",
							result: error.result,
							failedTargets,
						} satisfies ApplyPatchPartialFailureDetails;
						recordApplyPatchDisplayOutcome(toolCallId, {
							content: recoveryMessage,
							details,
							error: recoveryMessage,
							isError: true,
						});
						return {
							content: [{ type: "text", text: recoveryMessage }],
							details,
						};
					}
					const rawMessage = failedTargetSummary
						? `apply_patch failed while patching ${failedTargetSummary}: ${cause}`
						: `apply_patch failed: ${cause}`;
					const message = addContextRecovery(
						rawMessage,
						error.message,
						failedTargets,
					);
					markApplyPatchFailure(toolCallId, "failed", failedTargets);
					recordApplyPatchDisplayOutcome(toolCallId, {
						error: message,
						isError: true,
					});
					throw new Error(message);
				}
				markApplyPatchFailure(toolCallId, "failed");
				recordApplyPatchDisplayOutcome(toolCallId, {
					error: error instanceof Error ? error.message : String(error),
					isError: true,
				});
				throw error;
			}
			const summary =
				result.fuzz > 0
					? "Applied patch. Change details may be incomplete. Inspect the affected paths"
					: "OK";

			const details = {
				status: "success",
				result,
			} satisfies ApplyPatchSuccessDetails;
			recordApplyPatchDisplayOutcome(toolCallId, {
				content: summary,
				details,
				isError: false,
			});
			return { content: [{ type: "text", text: summary }], details };
		},
		renderCall: options.renderCall ?? defaultRenderCall,
		renderResult: options.renderResult ?? defaultRenderResult,
	} satisfies ApplyPatchToolDefinition;
}

export function registerApplyPatchResultEvent(pi: ExtensionAPI): void {
	pi.on("tool_result", (event) => {
		if (
			event.toolName === "apply_patch" &&
			isApplyPatchToolDetails(event.details) &&
			event.details.status === "partial_failure"
		) {
			return { isError: true };
		}
		return undefined;
	});
}
