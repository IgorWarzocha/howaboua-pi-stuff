import { formatApplyPatchCollapsedDiff, formatApplyPatchSummary, renderApplyPatchCall } from "./rendering.js";
const applyPatchRenderStates = new Map();
export function isApplyPatchToolDetails(details) {
    return typeof details === "object" && details !== null && "status" in details && "result" in details;
}
export function clearApplyPatchRenderState() {
    applyPatchRenderStates.clear();
}
export function setApplyPatchRenderState(toolCallId, patchText, cwd, status = "pending", failedTargets) {
    const collapsed = formatApplyPatchSummary(patchText, cwd);
    const collapsedDiff = formatApplyPatchCollapsedDiff(patchText, cwd);
    const expanded = renderApplyPatchCall(patchText, cwd);
    applyPatchRenderStates.set(toolCallId, { cwd, patchText, collapsed, collapsedDiff, expanded, status, failedTargets });
}
export function markApplyPatchPartialFailure(toolCallId, failedTargets) {
    markApplyPatchFailure(toolCallId, "partial_failure", failedTargets);
}
export function markApplyPatchFailure(toolCallId, status, failedTargets) {
    const existing = applyPatchRenderStates.get(toolCallId);
    if (!existing)
        return;
    applyPatchRenderStates.set(toolCallId, { ...existing, status, failedTargets });
}
function markFailedTargetLine(line, failedTarget) {
    const suffixMatch = line.match(/ \(\+\d+ -\d+\)$/);
    if (!suffixMatch)
        return undefined;
    const suffix = suffixMatch[0];
    const prefixAndTarget = line.slice(0, -suffix.length);
    const candidatePrefixes = ["• Edit partially failed ", "• Added ", "• Edited ", "• Deleted ", "  └ ", "    "];
    for (const prefix of candidatePrefixes) {
        if (prefixAndTarget === `${prefix}${failedTarget}`) {
            return `${prefix}${failedTarget} failed${suffix}`;
        }
    }
    return undefined;
}
function renderPartialFailureCall(text, theme, failedTargets) {
    const lines = text.split("\n");
    if (lines.length === 0)
        return theme.fg("warning", "• Edit partially failed");
    lines[0] = lines[0].replace(/^• (Added|Edited|Deleted)\b/, "• Edit partially failed");
    const failedLineIndexes = new Set();
    if (failedTargets) {
        for (let i = 0; i < lines.length; i += 1) {
            for (const failedTarget of failedTargets) {
                const failedLine = markFailedTargetLine(lines[i], failedTarget);
                if (failedLine) {
                    lines[i] = failedLine;
                    failedLineIndexes.add(i);
                    break;
                }
            }
        }
    }
    return lines.map((line, index) => {
        if (failedLineIndexes.has(index))
            return theme.fg("error", line);
        if (index === 0)
            return theme.fg("warning", line);
        return line;
    }).join("\n");
}
function renderFailedCall(text, theme, failedTargets) {
    const lines = text.split("\n");
    if (lines.length === 0)
        return theme.fg("error", "• Edit failed");
    lines[0] = lines[0].replace(/^• (Added|Edited|Deleted)\b/, "• Edit failed");
    const failedLineIndexes = new Set();
    if (failedTargets) {
        for (let i = 0; i < lines.length; i += 1) {
            for (const failedTarget of failedTargets) {
                const failedLine = markFailedTargetLine(lines[i], failedTarget);
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
export function renderApplyPatchCallFromState(args, theme, context) {
    if (context?.argsComplete === false)
        return `${theme.fg("dim", "•")} ${theme.bold("Patching")}`;
    const patchText = typeof args.input === "string" ? args.input : "";
    if (patchText.trim().length === 0)
        return `${theme.fg("dim", "•")} ${theme.bold("Patching")}`;
    const cached = context?.toolCallId ? applyPatchRenderStates.get(context.toolCallId) : undefined;
    const cwd = context?.cwd ?? cached?.cwd;
    const effectivePatchText = cached?.patchText ?? patchText;
    const baseText = context?.expanded
        ? cached?.expanded ?? renderApplyPatchCall(effectivePatchText, cwd)
        : context?.showCollapsedDiff
            ? cached?.collapsedDiff ?? formatApplyPatchCollapsedDiff(effectivePatchText, cwd)
            : cached?.collapsed ?? formatApplyPatchSummary(effectivePatchText, cwd);
    if (baseText.trim().length === 0) {
        if (cached?.status === "failed")
            return theme.fg("error", "• Edit failed");
        return `${theme.fg("dim", "•")} ${theme.bold("Patching")}`;
    }
    return cached?.status === "partial_failure"
        ? renderPartialFailureCall(baseText, theme, cached.failedTargets)
        : cached?.status === "failed"
            ? renderFailedCall(baseText, theme, cached.failedTargets)
            : baseText;
}
