import { resolve } from "node:path";
import { formatApplyPatchCollapsedDiff, formatApplyPatchSummary, renderApplyPatchCall } from "../apply-patch/rendering.js";
const pathApplyPatchPreviewStates = new Map();
export function clearPathApplyPatchPreviewStates() {
    pathApplyPatchPreviewStates.clear();
}
export function setPathApplyPatchPreviewState(toolCallId, command, cwd) {
    const plan = extractPathApplyPatchPreviewPlan(command, cwd);
    if (!plan)
        return;
    pathApplyPatchPreviewStates.set(toolCallId, { segments: plan.segments });
}
export function getPathApplyPatchRenderState(toolCallId) {
    if (!toolCallId)
        return undefined;
    return pathApplyPatchPreviewStates.get(toolCallId);
}
export function markPathApplyPatchPreviewExit(toolCallId, exitCode) {
    const state = pathApplyPatchPreviewStates.get(toolCallId);
    if (!state)
        return;
    state.exitCode = exitCode;
}
export function renderPathApplyPatchPreviewFromState(toolCallId, expanded) {
    const state = getPathApplyPatchRenderState(toolCallId);
    if (!state)
        return undefined;
    const text = state.segments
        .filter((segment) => segment.kind === "patch")
        .map((segment) => expanded ? segment.expanded : segment.collapsed)
        .filter((value) => value.trim().length > 0)
        .join("\n");
    return text.trim().length > 0 ? text : undefined;
}
export function extractPathApplyPatchPreviewPlan(command, cwd) {
    return extractHeredocApplyPatchPlan(command, cwd) ?? extractArgumentApplyPatchPlan(command, cwd);
}
export function extractPathApplyPatchPreviewInput(command, cwd) {
    return extractHeredocApplyPatchInput(command, cwd) ?? extractArgumentApplyPatchInput(command, cwd);
}
function extractHeredocApplyPatchPlan(command, cwd) {
    const lines = command.split(/\r?\n/);
    const segments = [];
    let commandStartIndex = 0;
    let foundPatch = false;
    for (let index = 0; index < lines.length; index += 1) {
        const parsed = parseApplyPatchHeredocLine(lines[index]);
        if (!parsed)
            continue;
        const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
        if (endIndex === -1)
            return undefined;
        const commandBeforePatch = cleanCommand(lines.slice(commandStartIndex, index).join("\n"));
        if (hasDanglingConnector(commandBeforePatch))
            return undefined;
        if (commandBeforePatch)
            segments.push({ kind: "command", command: commandBeforePatch });
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
        if (parsed.afterCommand)
            segments.push({ kind: "command", command: parsed.afterCommand });
        foundPatch = true;
        commandStartIndex = endIndex + 1;
        index = endIndex;
    }
    if (!foundPatch)
        return undefined;
    const remainingCommand = cleanCommand(lines.slice(commandStartIndex).join("\n"));
    if (remainingCommand)
        segments.push({ kind: "command", command: remainingCommand });
    return { segments };
}
function extractArgumentApplyPatchPlan(command, cwd) {
    const input = extractArgumentApplyPatchInput(command, cwd);
    if (!input)
        return undefined;
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
function extractHeredocApplyPatchInput(command, cwd) {
    const lines = command.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const parsed = parseApplyPatchHeredocLine(lines[index]);
        if (!parsed)
            continue;
        const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
        if (endIndex === -1)
            return undefined;
        const beforeCommand = cleanCommand(lines.slice(0, index).join("\n"));
        if (hasDanglingConnector(beforeCommand))
            return undefined;
        const bodyLines = lines.slice(index + 1, endIndex);
        const patchText = parsed.stripLeadingTabs
            ? bodyLines.map((line) => line.replace(/^\t+/, "")).join("\n")
            : bodyLines.join("\n");
        return {
            cwd: parsed.cdPath ? resolve(cwd, parsed.cdPath) : cwd,
            patchText,
            beforeCommand,
            afterCommand: cleanCommand([parsed.afterCommand, lines.slice(endIndex + 1).join("\n")].filter(Boolean).join("\n")),
        };
    }
    return undefined;
}
function parseApplyPatchHeredocLine(line) {
    const match = line.match(/^\s*(?:(?:cd\s+("[^"]+"|'[^']+'|[^&;\s]+)\s*&&\s*)?)(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*)?(?:[^\s;&|()]+\/)?apply_patch\s+<<(-?)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))(?:\s*((?:&&|\|\||;)\s+.+))?\s*$/);
    if (!match)
        return undefined;
    const cdPath = match[1] ? unquoteShellToken(match[1]) : undefined;
    const delimiter = match[3] ?? match[4] ?? match[5];
    if (!delimiter)
        return undefined;
    return { delimiter, cdPath, stripLeadingTabs: match[2] === "-", afterCommand: cleanTrailingCommand(match[6]) };
}
function findHeredocEnd(lines, startIndex, delimiter, stripLeadingTabs) {
    for (let index = startIndex; index < lines.length; index += 1) {
        const line = stripLeadingTabs ? lines[index].replace(/^\t+/, "") : lines[index];
        if (line === delimiter)
            return index;
    }
    return -1;
}
function extractArgumentApplyPatchInput(command, cwd) {
    const match = command.match(/^\s*(?:(?:cd\s+("[^"]+"|'[^']+'|[^&;\s]+)\s*&&\s*)?)(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*)?(?:[^\s;&|()]+\/)?apply_patch\s+([\s\S]+?)\s*$/);
    if (!match)
        return undefined;
    const cdPath = match[1] ? unquoteShellToken(match[1]) : undefined;
    const patchText = unquoteShellToken(match[2].trim());
    if (!patchText.startsWith("*** Begin Patch"))
        return undefined;
    return { cwd: cdPath ? resolve(cwd, cdPath) : cwd, patchText };
}
function cleanCommand(command) {
    const trimmed = command.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function cleanTrailingCommand(command) {
    if (!command)
        return undefined;
    return cleanCommand(command.replace(/^(?:&&|\|\||;)\s*/, ""));
}
function hasDanglingConnector(command) {
    return Boolean(command && /(?:&&|\|\||\|)\s*$/.test(command));
}
function unquoteShellToken(token) {
    if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
        return token.slice(1, -1);
    }
    return token;
}
