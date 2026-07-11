import { basename } from "node:path";
import { joinCommandTokens, shellSplit } from "../../shell/tokenize.js";
import { renderExecCommandCall } from "../../ui/tool-rendering/codex-rendering.js";
export function renderPathToolCommandCall(command, theme, status = "done") {
    const segments = parsePathToolRenderSegments(command);
    if (!segments)
        return undefined;
    const text = segments.map((segment) => renderPathToolSegment(segment, theme, status)).filter(Boolean).join("\n");
    return text.trim().length > 0 ? text : undefined;
}
function renderPathToolSegment(segment, theme, status) {
    if (segment.kind === "command")
        return renderExecCommandCall(segment.command, status, theme);
    if (segment.toolName === "view_image") {
        return renderPathToolCell("Viewed Image", firstString(segment.params, "path") ?? firstString(segment.params, "file_path") ?? firstString(segment.params, "image_path"), theme, segment.shellSuffix);
    }
    if (segment.toolName === "web_run") {
        const detail = webRunCallDetail(segment.params);
        return renderPathToolCell(webRunCallTitle(segment.params), detail, theme, segment.shellSuffix);
    }
    const action = firstString(segment.params, "action");
    return renderPathToolCell(action === "edit" ? "Edited Image:" : "Generated Image:", firstString(segment.params, "prompt"), theme, segment.shellSuffix);
}
function renderPathToolCell(title, detail, theme, shellSuffix) {
    let text = `${theme.fg("dim", "•")} ${theme.bold(title)}`;
    if (detail?.trim()) {
        text += `\n${theme.fg("dim", "  └ ")}${theme.fg("accent", detail.trim())}`;
    }
    if (shellSuffix?.trim()) {
        text += `\n${theme.fg("dim", "  └ ")}${theme.fg("muted", `shell: ${shellSuffix.trim()}`)}`;
    }
    return text;
}
function parsePathToolRenderSegments(command) {
    return parseHeredocPathToolRenderSegments(command) ?? parseArgvPathToolRenderSegments(command);
}
function parseArgvPathToolRenderSegments(command) {
    let tokens;
    try {
        tokens = shellSplit(command);
    }
    catch {
        return undefined;
    }
    if (tokens.some((token) => token === "&&" || token === "||" || token === "|"))
        return undefined;
    const segments = [];
    let current = [];
    let found = false;
    const flushPart = () => {
        if (current.length === 0)
            return;
        const segment = parseArgvPathToolPart(current);
        if (segment) {
            segments.push(segment);
            found = true;
        }
        else {
            segments.push({ kind: "command", command: joinCommandTokens(current) });
        }
        current = [];
    };
    for (const token of tokens) {
        if (isConnector(token)) {
            flushPart();
            continue;
        }
        current.push(token);
    }
    flushPart();
    return found ? segments : undefined;
}
function parseArgvPathToolPart(part) {
    const commandIndex = findPathToolCommandIndex(part);
    if (commandIndex === -1)
        return undefined;
    const toolName = pathToolNameFromToken(part[commandIndex]);
    if (!toolName)
        return undefined;
    const arg = part[commandIndex + 1];
    if (!arg)
        return undefined;
    const params = parseJsonObject(arg);
    if (!params)
        return undefined;
    const suffixTokens = part.slice(commandIndex + 2);
    return {
        kind: "tool",
        toolName,
        params,
        ...(suffixTokens.length > 0 ? { shellSuffix: joinCommandTokens(suffixTokens) } : {}),
    };
}
function parseHeredocPathToolRenderSegments(command) {
    const lines = command.split(/\r?\n/);
    const segments = [];
    let commandStartIndex = 0;
    let found = false;
    for (let index = 0; index < lines.length; index += 1) {
        const parsed = parsePathToolHeredocLine(lines[index]);
        if (!parsed)
            continue;
        const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
        if (endIndex === -1)
            return undefined;
        const commandBeforeTool = cleanCommand(lines.slice(commandStartIndex, index).join("\n"));
        if (hasDanglingConnector(commandBeforeTool))
            return undefined;
        if (commandBeforeTool)
            segments.push({ kind: "command", command: commandBeforeTool });
        const bodyLines = lines.slice(index + 1, endIndex);
        const body = parsed.stripLeadingTabs
            ? bodyLines.map((line) => line.replace(/^\t+/, "")).join("\n")
            : bodyLines.join("\n");
        const params = parseJsonObject(body.trim());
        if (!params)
            return undefined;
        segments.push({ kind: "tool", toolName: parsed.toolName, params });
        found = true;
        commandStartIndex = endIndex + 1;
        index = endIndex;
    }
    if (!found)
        return undefined;
    const remainingCommand = cleanCommand(lines.slice(commandStartIndex).join("\n"));
    if (remainingCommand)
        segments.push({ kind: "command", command: remainingCommand });
    return segments;
}
function hasDanglingConnector(command) {
    return Boolean(command && /(?:&&|\|\||\|)\s*$/.test(command));
}
function parsePathToolHeredocLine(line) {
    const match = line.match(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*)?(?:[^\s;&|()]+\/)?(view_image|web_run|imagegen)\s+<<(-?)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*$/);
    if (!match)
        return undefined;
    const delimiter = match[3] ?? match[4] ?? match[5];
    if (!delimiter)
        return undefined;
    return { toolName: match[1], delimiter, stripLeadingTabs: match[2] === "-" };
}
function findHeredocEnd(lines, startIndex, delimiter, stripLeadingTabs) {
    for (let index = startIndex; index < lines.length; index += 1) {
        const line = stripLeadingTabs ? lines[index].replace(/^\t+/, "") : lines[index];
        if (line === delimiter)
            return index;
    }
    return -1;
}
function findPathToolCommandIndex(tokens) {
    let index = 0;
    while (index < tokens.length && isEnvAssignment(tokens[index]))
        index += 1;
    if (tokens[index] === "env") {
        index += 1;
        while (index < tokens.length && isEnvAssignment(tokens[index]))
            index += 1;
    }
    return pathToolNameFromToken(tokens[index] ?? "") ? index : -1;
}
function isEnvAssignment(token) {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}
function isConnector(token) {
    return token === ";";
}
function pathToolNameFromToken(token) {
    const name = basename(token.replace(/\\/g, "/"));
    return name === "view_image" || name === "web_run" || name === "imagegen" ? name : undefined;
}
function parseJsonObject(text) {
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function cleanCommand(command) {
    const trimmed = command.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function firstString(value, key) {
    if (!value || typeof value !== "object")
        return undefined;
    const field = value[key];
    return typeof field === "string" && field.trim() ? field.trim() : undefined;
}
function firstRecord(value, key) {
    if (!value || typeof value !== "object")
        return undefined;
    const field = value[key];
    return Array.isArray(field) && field[0] && typeof field[0] === "object" ? field[0] : undefined;
}
function webRunCallTitle(params) {
    if (firstRecord(params, "open"))
        return "Opened Web Page";
    if (firstRecord(params, "click"))
        return "Clicked Web Result";
    if (firstRecord(params, "find"))
        return "Searched Web Page";
    return "Searched the web";
}
function webRunCallDetail(params) {
    const search = firstRecord(params, "search_query");
    const image = firstRecord(params, "image_query");
    const open = firstRecord(params, "open");
    const click = firstRecord(params, "click");
    const find = firstRecord(params, "find");
    const query = firstString(search, "q") ?? firstString(image, "q");
    if (query)
        return query;
    const opened = firstString(open, "url") ?? firstString(open, "ref_id") ?? firstString(click, "ref_id");
    if (opened)
        return opened;
    const pattern = firstString(find, "pattern");
    return pattern ? `'${pattern}'` : undefined;
}
