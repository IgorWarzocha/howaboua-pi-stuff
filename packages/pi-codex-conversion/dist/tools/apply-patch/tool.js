import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { ExecutePatchError } from "../../patch/types.js";
import { formatPatchTarget } from "./rendering.js";
import { executePatchWithRust } from "./executor.js";
import { clearApplyPatchRenderState, isApplyPatchToolDetails, markApplyPatchFailure, markApplyPatchPartialFailure, renderApplyPatchCallFromState, setApplyPatchRenderState, } from "./render-state.js";
const APPLY_PATCH_PARAMETERS = Type.Object({
    input: Type.String({
        description: "Full patch text. Use *** Begin Patch / *** End Patch with Add/Update/Delete File sections.",
    }),
});
function parseApplyPatchParams(params) {
    if (!params || typeof params !== "object" || !("input" in params) || typeof params.input !== "string") {
        throw new Error("apply_patch requires a string 'input' parameter");
    }
    return { patchText: params.input };
}
function prepareApplyPatchArguments(args) {
    if (args && typeof args === "object") {
        if ("input" in args && typeof args.input === "string")
            return { input: args.input };
        if ("patchText" in args && typeof args.patchText === "string")
            return { input: args.patchText };
        if ("patch" in args && typeof args.patch === "string")
            return { input: args.patch };
    }
    return args;
}
function summarizePatchCounts(result) {
    return [
        `changed ${result.changedFiles.length} file${result.changedFiles.length === 1 ? "" : "s"}`,
        `created ${result.createdFiles.length}`,
        `deleted ${result.deletedFiles.length}`,
        `moved ${result.movedFiles.length}`,
    ].join(", ");
}
function uniqueStrings(values) {
    return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}
function getFailedPaths(error) {
    return uniqueStrings(error.failures.flatMap(({ action }) => [action.path, action.type === "update" ? action.movePath : undefined]));
}
function getAppliedPaths(result, failedFiles) {
    return result.changedFiles.filter((path) => !failedFiles.includes(path));
}
function buildPartialFailureMessage(message, failedFiles, appliedFiles) {
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
function describeFailedActions(error, cwd) {
    return uniqueStrings(error.failures.map(({ action }) => formatPatchTarget(action.path, action.type === "update" ? action.movePath : undefined, cwd)));
}
export { clearApplyPatchRenderState };
const renderApplyPatchCallWithOptionalContext = (args, theme, context, options = {}) => new Text(renderApplyPatchCallFromState(args, theme, { ...context, showCollapsedDiff: options.showDiffWhenCollapsed }), 0, 0);
export function registerApplyPatchTool(pi, options = {}) {
    pi.registerTool({
        name: "apply_patch",
        label: "apply_patch",
        description: "Patch files.",
        ...(options.promptSnippet === false ? {} : { promptSnippet: "Edit files with patch." }),
        parameters: APPLY_PATCH_PARAMETERS,
        prepareArguments: prepareApplyPatchArguments,
        async execute(toolCallId, params, signal, _onUpdate, ctx) {
            if (signal?.aborted)
                throw new Error("apply_patch aborted");
            const typedParams = parseApplyPatchParams(params);
            setApplyPatchRenderState(toolCallId, typedParams.patchText, ctx.cwd);
            let result;
            try {
                result = await executePatchWithRust({ cwd: ctx.cwd, patchText: typedParams.patchText, signal });
            }
            catch (error) {
                if (error instanceof ExecutePatchError) {
                    const partial = error.hasPartialSuccess();
                    const failedTargets = describeFailedActions(error, ctx.cwd);
                    const failedTargetSummary = failedTargets.join(", ");
                    const prefix = partial ? `apply_patch partially failed after ${summarizePatchCounts(error.result)}` : "apply_patch failed";
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
                                recoveryInstructions: { mustReadFiles: failedFiles, mustNotReadFiles: appliedFiles },
                            },
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
            return { content: [{ type: "text", text: summary }], details: { status: "success", result } };
        },
        renderCall: ((args, theme, context) => renderApplyPatchCallWithOptionalContext(args, theme, context, options)),
        renderResult(result, { isPartial }, theme) {
            if (isPartial)
                return new Text(`${theme.fg("dim", "•")} ${theme.bold("Patching")}`, 0, 0);
            if (!isApplyPatchToolDetails(result.details))
                return new Container();
            if (result.details.status === "partial_failure")
                return new Container();
            return new Container();
        },
    });
}
