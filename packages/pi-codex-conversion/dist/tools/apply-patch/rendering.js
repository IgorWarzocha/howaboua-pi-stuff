import { isAbsolute, relative } from "node:path";
import { keyHint, renderDiff } from "@earendil-works/pi-coding-agent";
import { openFileAtPath } from "../../patch/paths.js";
import { parsePatchActions } from "../../patch/parser.js";
function expandHint() {
    try {
        return keyHint("app.tools.expand", "to expand");
    }
    catch {
        return "ctrl+o to expand";
    }
}
export function formatApplyPatchSummary(patchText, cwd = process.cwd()) {
    let actions;
    try {
        actions = parsePatchActions({ text: patchText });
    }
    catch {
        return "";
    }
    const files = actions.map((action) => buildFilePreview(action, cwd));
    if (files.length === 0) {
        return "";
    }
    const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
    const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
    const lines = [];
    if (files.length === 1) {
        const file = files[0];
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
export function formatApplyPatchCall(patchText, cwd = process.cwd()) {
    let actions;
    try {
        actions = parsePatchActions({ text: patchText });
    }
    catch {
        return "";
    }
    const files = actions.map((action) => buildFilePreview(action, cwd));
    if (files.length === 0) {
        return "";
    }
    const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
    const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
    const lines = [];
    if (files.length === 1) {
        const file = files[0];
        lines.push(`${bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd))} ${renderCounts(file.added, file.removed)}`);
        lines.push(...file.lines.map((line) => formatPreviewLine(line, file.lines)));
        return lines.join("\n");
    }
    lines.push(`${bulletHeader("Edited", `${files.length} files`)} ${renderCounts(totalAdded, totalRemoved)}`);
    for (const [index, file] of files.entries()) {
        if (index > 0) {
            lines.push("");
        }
        lines.push(`  └ ${formatPatchTarget(file.path, file.movePath, cwd)} ${renderCounts(file.added, file.removed)}`);
        lines.push(...file.lines.map((line) => formatPreviewLine(line, file.lines)));
    }
    return lines.join("\n");
}
export function formatApplyPatchCollapsedDiff(patchText, cwd = process.cwd(), maxPreviewLines = 10) {
    const full = renderApplyPatchCall(patchText, cwd);
    if (!full)
        return formatApplyPatchSummary(patchText, cwd);
    const fullLines = full.split("\n");
    const visibleLines = fullLines.slice(0, maxPreviewLines + 1);
    const remaining = fullLines.length - visibleLines.length;
    const lines = [...visibleLines];
    if (remaining > 0) {
        lines.push(`    ... (${remaining} more lines, ${expandHint()})`);
    }
    return lines.join("\n");
}
export function renderApplyPatchCall(patchText, cwd = process.cwd()) {
    let actions;
    try {
        actions = parsePatchActions({ text: patchText });
    }
    catch {
        return "";
    }
    const files = actions.map((action) => buildFilePreview(action, cwd));
    if (files.length === 0) {
        return "";
    }
    const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
    const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
    const lines = [];
    if (files.length === 1) {
        const file = files[0];
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
function buildFilePreview(action, cwd) {
    if (action.type === "add") {
        const lines = splitFileLines(action.newFile ?? "");
        return {
            verb: "Added",
            path: action.path,
            added: lines.length,
            removed: 0,
            lines: lines.map((text, index) => ({ lineNumber: index + 1, marker: "+", text })),
        };
    }
    if (action.type === "delete") {
        const deletedLines = readFileLines(action.path, cwd);
        return {
            verb: "Deleted",
            path: action.path,
            added: 0,
            removed: deletedLines.length,
            lines: deletedLines.map((text, index) => ({ lineNumber: index + 1, marker: "-", text })),
        };
    }
    const preview = buildUpdatePreview(action, cwd);
    return {
        verb: "Edited",
        path: action.path,
        movePath: action.movePath,
        added: preview.added,
        removed: preview.removed,
        lines: preview.lines,
    };
}
function buildUpdatePreview(action, cwd) {
    if (!action.lines) {
        return { added: 0, removed: 0, lines: [] };
    }
    const originalLines = readFileLines(action.path, cwd);
    const renderedLines = [];
    let added = 0;
    let removed = 0;
    let searchStart = 0;
    let delta = 0;
    let index = 0;
    while (index < action.lines.length) {
        const line = action.lines[index];
        if (line === "*** End of File") {
            break;
        }
        if (!line.startsWith("@@")) {
            index += 1;
            continue;
        }
        index += 1;
        const sectionLines = [];
        while (index < action.lines.length && !action.lines[index].startsWith("@@") && action.lines[index] !== "*** End of File") {
            sectionLines.push(action.lines[index]);
            index += 1;
        }
        if (sectionLines.length === 0) {
            continue;
        }
        const oldSequence = sectionLines
            .map(normalizePatchLine)
            .filter((entry) => entry.marker === " " || entry.marker === "-")
            .map((entry) => entry.text);
        const sectionStart = findMatchingSequence(originalLines, oldSequence, searchStart);
        let oldLineNumber = sectionStart + 1;
        let newLineNumber = sectionStart + 1 + delta;
        for (const rawLine of sectionLines) {
            const entry = normalizePatchLine(rawLine);
            if (entry.marker === "+") {
                added += 1;
                renderedLines.push({ lineNumber: newLineNumber, marker: "+", text: entry.text });
                newLineNumber += 1;
                continue;
            }
            if (entry.marker === "-") {
                removed += 1;
                renderedLines.push({ lineNumber: oldLineNumber, marker: "-", text: entry.text });
                oldLineNumber += 1;
                continue;
            }
            renderedLines.push({ lineNumber: newLineNumber, marker: " ", text: entry.text });
            oldLineNumber += 1;
            newLineNumber += 1;
        }
        searchStart = sectionStart + oldSequence.length;
        delta += sectionLines.reduce((sum, rawLine) => {
            const marker = normalizePatchLine(rawLine).marker;
            if (marker === "+")
                return sum + 1;
            if (marker === "-")
                return sum - 1;
            return sum;
        }, 0);
    }
    return { added, removed, lines: renderedLines };
}
function formatPreviewLine(line, lines) {
    const numberWidth = Math.max(1, ...lines.map((entry) => String(entry.lineNumber).length));
    return `    ${String(line.lineNumber).padStart(numberWidth, " ")} ${line.marker}${line.text}`;
}
function renderPreviewLines(lines) {
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
    }
    catch {
        return lines.map((line) => formatPreviewLine(line, lines));
    }
}
function normalizePatchLine(rawLine) {
    const normalized = rawLine === "" ? " " : rawLine;
    const marker = normalized[0];
    if (marker !== " " && marker !== "+" && marker !== "-") {
        return { lineNumber: 0, marker: " ", text: rawLine };
    }
    return { lineNumber: 0, marker, text: normalized.slice(1) };
}
function findMatchingSequence(lines, context, start) {
    if (context.length === 0) {
        return start;
    }
    const exact = findSequence(lines, context, start, (value) => value);
    if (exact !== -1) {
        return exact;
    }
    const trimEnd = findSequence(lines, context, start, (value) => value.trimEnd());
    if (trimEnd !== -1) {
        return trimEnd;
    }
    const trim = findSequence(lines, context, start, (value) => value.trim());
    if (trim !== -1) {
        return trim;
    }
    return start;
}
function findSequence(lines, context, start, normalize) {
    for (let lineIndex = start; lineIndex <= lines.length - context.length; lineIndex += 1) {
        let matches = true;
        for (let contextIndex = 0; contextIndex < context.length; contextIndex += 1) {
            if (normalize((lines[lineIndex + contextIndex])) !== normalize(context[contextIndex])) {
                matches = false;
                break;
            }
        }
        if (matches) {
            return lineIndex;
        }
    }
    return -1;
}
export function formatPatchTarget(path, movePath, cwd) {
    const from = displayPath(path, cwd);
    if (!movePath) {
        return from;
    }
    return `${from} → ${displayPath(movePath, cwd)}`;
}
function displayPath(path, cwd) {
    if (!isAbsolute(path)) {
        return path;
    }
    const relativePath = relative(cwd, path);
    if (relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
        return relativePath;
    }
    return path;
}
function readFileLines(path, cwd) {
    try {
        return splitFileLines(openFileAtPath({ cwd, path }));
    }
    catch {
        return [];
    }
}
function splitFileLines(text) {
    if (text.length === 0) {
        return [];
    }
    const lines = text.split("\n");
    if (lines.at(-1) === "") {
        lines.pop();
    }
    return lines;
}
function bulletHeader(verb, label) {
    return `• ${verb} ${label}`;
}
function renderCounts(added, removed) {
    return `(+${added} -${removed})`;
}
