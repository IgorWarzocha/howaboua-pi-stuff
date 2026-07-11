import { readFileSync } from "node:fs";
import { formatUnifiedExecResult } from "../exec/format.js";
import { shellSplit, splitOnConnectors } from "../../shell/tokenize.js";
export function getPathToolPolicy(command, model, options = {}) {
    const supportsImages = Array.isArray(model?.input) && model.input.includes("image");
    const pathToolNames = getPathToolNamesFromParts(commandPartsForDetection(command), ["apply_patch", "view_image", "web_run", "imagegen"]);
    const hasWebRun = pathToolNames.includes("web_run");
    const hasImagegen = pathToolNames.includes("imagegen");
    const hasMultiplePathTools = pathToolNames.length > 1;
    const isViewImage = isSimplePathToolOutputCommand(command, "view_image");
    if (isViewImage && !supportsImages && !options.describeImages) {
        return { disableTruncation: true, suppressPartials: true, unsupportedMessage: "view_image requires an image-capable model", parseApplyPatchOutput: false, describeImageOutput: false, parseImageOutput: false, parseWebRunOutput: false, parseImagegenOutput: false, includeImagegenImageContent: false };
    }
    const isWebRun = !hasMultiplePathTools && isSimplePathToolOutputCommand(command, "web_run");
    const isImagegen = !hasMultiplePathTools && isSimplePathToolOutputCommand(command, "imagegen");
    const describeImageOutput = isViewImage && !supportsImages && Boolean(options.describeImages);
    const modelInput = model?.input;
    const parseApplyPatchOutput = !hasMultiplePathTools && isPathApplyPatchCommand(command);
    const parseImageOutput = isViewImage && supportsImages;
    const parseWebRunOutput = isWebRun;
    const parseImagegenOutput = isImagegen;
    const includeImagegenImageContent = isImagegen && (!Array.isArray(modelInput) || modelInput.includes("image"));
    const waitForLongPathTool = hasWebRun || hasImagegen;
    if (!parseApplyPatchOutput && !parseImageOutput && !describeImageOutput && !parseWebRunOutput && !parseImagegenOutput && !waitForLongPathTool)
        return undefined;
    const disableTruncation = parseApplyPatchOutput || parseImageOutput || describeImageOutput || parseWebRunOutput || parseImagegenOutput;
    return { disableTruncation, suppressPartials: true, ...(waitForLongPathTool ? { yieldTimeMs: 3_600_000 } : {}), parseApplyPatchOutput, describeImageOutput, parseImageOutput, parseWebRunOutput, parseImagegenOutput, includeImagegenImageContent };
}
export function convertPathToolExecResult(command, result, policy) {
    if (!policy || result.session_id !== undefined)
        return undefined;
    if (policy.parseApplyPatchOutput) {
        const details = sanitizeExecResult(result, result.output);
        return { content: [{ type: "text", text: formatPathApplyPatchOutput(details) }], details };
    }
    if (result.exit_code !== 0)
        return undefined;
    if (policy.parseImageOutput) {
        const imageContents = imageContentsFromCodexViewImageOutput(result.output);
        if (imageContents.length) {
            const details = sanitizeExecResult(result, "<image output>");
            return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }, ...imageContents], details };
        }
        return undefined;
    }
    if (policy.describeImageOutput) {
        const parsed = pathViewImageDescriptionOutputFromJson(result.output);
        if (parsed) {
            const image = imageContentFromCodexViewImageJson(JSON.stringify({ image_url: parsed.image_url, detail: parsed.detail ?? "high" }));
            const details = sanitizeExecResult(result, parsed.description, { viewImageDescription: image ? { image, description: parsed.description } : { description: parsed.description } });
            return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }], details };
        }
        return undefined;
    }
    if (policy.parseWebRunOutput) {
        const parsed = pathWebRunOutputFromJson(result.output);
        if (parsed) {
            const details = sanitizeExecResult(result, formatPathWebRunOutput(parsed), { webRun: parsed });
            return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }], details };
        }
        return undefined;
    }
    if (policy.parseImagegenOutput) {
        const parsed = pathImagegenOutputFromJson(result.output);
        if (parsed) {
            const imageContents = policy.includeImagegenImageContent ? imageContentsFromPathImagegenOutput(parsed) : [];
            const details = sanitizeExecResult(result, formatPathImagegenOutput(parsed), { imagegen: parsed });
            return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }, ...imageContents], details };
        }
        return undefined;
    }
    return undefined;
}
export function imageContentFromCodexViewImageOutput(output) {
    return imageContentsFromCodexViewImageOutput(output)[0];
}
export function imageContentsFromCodexViewImageOutput(output) {
    const trimmed = output.trim();
    if (!trimmed)
        return [];
    const whole = imageContentFromCodexViewImageJson(trimmed);
    if (whole)
        return [whole];
    return trimmed.split(/\r?\n/).flatMap((line) => {
        const image = imageContentFromCodexViewImageJson(line.trim());
        return image ? [image] : [];
    });
}
function imageContentFromCodexViewImageJson(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const imageUrl = parsed["image_url"];
    const detail = parsed["detail"];
    if (typeof imageUrl !== "string" || (detail !== "high" && detail !== "original"))
        return undefined;
    const match = imageUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match)
        return undefined;
    return { type: "image", mimeType: match[1], data: match[2], detail };
}
function isPathApplyPatchCommand(command) {
    return hasPathToolCommand(command, "apply_patch");
}
function isPathWebRunCommand(command) {
    return hasPathToolCommand(command, "web_run");
}
function isPathImagegenCommand(command) {
    return hasPathToolCommand(command, "imagegen");
}
function isSimplePathToolOutputCommand(command, toolName) {
    if (isSimplePathToolHeredocCommand(command, toolName))
        return true;
    let tokens;
    try {
        tokens = shellSplit(command);
    }
    catch {
        return false;
    }
    if (tokens.some((token) => token === "|" || token === "||"))
        return false;
    let found = 0;
    for (const part of splitOnConnectors(tokens).filter((item) => item.length > 0)) {
        const commandIndex = findPathToolCommandIndex(part, toolName);
        if (commandIndex === -1) {
            if (!isEnvironmentOnlyPart(part))
                return false;
            continue;
        }
        if (getPathToolNamesFromParts([part], ["view_image", "web_run", "imagegen"]).length !== 1)
            return false;
        const tail = part.slice(commandIndex + 1);
        if (!isSimplePathToolTail(tail))
            return false;
        found += 1;
    }
    if (toolName !== "view_image" && found > 1)
        return false;
    return found > 0;
}
function isSimplePathToolHeredocCommand(command, toolName) {
    const lines = command.split(/\r?\n/);
    let found = 0;
    let commandStartIndex = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const parsed = parsePathToolHeredocLine(lines[index], toolName);
        if (!parsed)
            continue;
        if (parsed.afterCommand)
            return false;
        const beforeCommand = cleanCommand(lines.slice(commandStartIndex, index).join("\n"));
        if (beforeCommand && !isEnvironmentOnlyCommand(beforeCommand))
            return false;
        const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
        if (endIndex === -1)
            return false;
        found += 1;
        commandStartIndex = endIndex + 1;
        index = endIndex;
    }
    if (found === 0)
        return false;
    const afterCommand = cleanCommand(lines.slice(commandStartIndex).join("\n"));
    return !afterCommand && (toolName === "view_image" || found === 1);
}
function parsePathToolHeredocLine(line, toolName) {
    const match = line.match(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*)?(?:[^\s;&|()]+\/)?(view_image|web_run|imagegen)\s+<<(-?)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))(?:\s*((?:&&|\|\||;)\s+.+))?\s*$/);
    if (!match || match[1] !== toolName)
        return undefined;
    const delimiter = match[3] ?? match[4] ?? match[5];
    if (!delimiter)
        return undefined;
    return { delimiter, stripLeadingTabs: match[2] === "-", afterCommand: cleanTrailingCommand(match[6]) };
}
function findHeredocEnd(lines, startIndex, delimiter, stripLeadingTabs) {
    for (let index = startIndex; index < lines.length; index += 1) {
        const line = stripLeadingTabs ? lines[index].replace(/^\t+/, "") : lines[index];
        if (line === delimiter)
            return index;
    }
    return -1;
}
function isEnvironmentOnlyCommand(command) {
    let tokens;
    try {
        tokens = shellSplit(command);
    }
    catch {
        return false;
    }
    return splitOnConnectors(tokens).filter((item) => item.length > 0).every(isEnvironmentOnlyPart);
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
function findPathToolCommandIndex(part, toolName) {
    let index = 0;
    while (["if", "then", "else", "elif", "do", "while", "until", "time", "!"].includes(part[index]))
        index += 1;
    while (index < part.length && isEnvAssignment(part[index]))
        index += 1;
    if (part[index] === "env") {
        index += 1;
        while (index < part.length && isEnvAssignment(part[index]))
            index += 1;
    }
    if (part[index] === "command" && part[index + 1] !== "-v")
        index += 1;
    return pathToolTokenName(part[index] ?? "") === toolName ? index : -1;
}
function isEnvironmentOnlyPart(part) {
    return part.length > 0 && part.every(isEnvAssignment);
}
function isSimplePathToolTail(tokens) {
    if (tokens.length === 0)
        return true;
    if (tokens.length !== 1)
        return false;
    const token = tokens[0];
    if (/^(?:\d*)[<>]/.test(token) || token.includes(">") || token.includes("<"))
        return false;
    return true;
}
function isEnvAssignment(token) {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}
function pathToolTokenName(token) {
    return token.replace(/\\/g, "/").split("/").pop();
}
export function getCodexBackedPathToolNames(command, options = {}) {
    return [
        ...(isPathWebRunCommand(command) ? ["web_run"] : []),
        ...(isPathImagegenCommand(command) ? ["imagegen"] : []),
        ...(options.includeViewImageDescription && hasPathToolCommand(command, "view_image") ? ["view_image"] : []),
    ];
}
function hasPathToolCommand(command, toolName) {
    return getPathToolNamesFromParts(commandPartsForDetection(command), [toolName]).includes(toolName);
}
function getPathToolNamesFromParts(parts, toolNames) {
    const found = new Set();
    for (const part of parts) {
        if (isPathToolDiscoveryPart(part))
            continue;
        for (const toolName of toolNames) {
            if (partHasPathToolCommand(part, toolName))
                found.add(toolName);
        }
    }
    return [...found];
}
function splitCommandParts(command) {
    try {
        return splitOnConnectors(shellSplit(stripHeredocBodies(command))).filter((part) => part.length > 0);
    }
    catch {
        return [[command]];
    }
}
function commandPartsForDetection(command) {
    return splitCommandParts(command);
}
function stripHeredocBodies(command) {
    const lines = command.split(/\r?\n/);
    const kept = [];
    let heredocEnd;
    for (const line of lines) {
        if (heredocEnd) {
            if (line.replace(/^\t+/, "") === heredocEnd)
                heredocEnd = undefined;
            continue;
        }
        kept.push(line);
        const match = line.match(/<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))(?:\s*(?:&&|\|\||;)\s+.+)?\s*$/);
        if (match)
            heredocEnd = match[1] ?? match[2] ?? match[3];
    }
    return kept.join("\n");
}
function partHasPathToolCommand(part, toolName) {
    return findPathToolCommandIndex(part, toolName) !== -1;
}
function isPathToolDiscoveryPart(part) {
    if (part[0] === "which")
        return part.length >= 2 && ["apply_patch", "view_image", "web_run", "imagegen"].includes(part[1]);
    return part[0] === "command" && part[1] === "-v" && part.length >= 3 && ["apply_patch", "view_image", "web_run", "imagegen"].includes(part[2]);
}
function pathWebRunOutputFromJson(output) {
    let parsed;
    try {
        parsed = JSON.parse(output.trim());
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const record = parsed;
    const text = record["text"] ?? record["output_text"];
    if (typeof text !== "string" && typeof record["encrypted_output"] !== "string" && !Array.isArray(record["search_results"]) && !Array.isArray(record["content"]) && !Array.isArray(record["open"]))
        return undefined;
    return parsed;
}
function formatPathWebRunOutput(output) {
    if (Array.isArray(output.content))
        return formatPathWebRunPage(output);
    if (Array.isArray(output.open) && output.open.length === 1)
        return formatPathWebRunPage(output.open[0]);
    const lines = [output.text || output.output_text || "(no text output)"];
    const citations = Array.isArray(output.search_results) ? output.search_results : Array.isArray(output.citations) ? output.citations : [];
    if (citations.length) {
        lines.push("", "Sources:");
        for (const [index, citation] of citations.entries()) {
            const title = typeof citation.title === "string" && citation.title ? citation.title : citation.url;
            const url = typeof citation.url === "string" ? citation.url : undefined;
            lines.push(`${index + 1}. ${title ?? "source"}${url ? `\n   ${url}` : ""}`);
        }
    }
    return lines.join("\n");
}
function formatPathWebRunPage(page) {
    const lines = [`Title: ${page.title ?? "(untitled)"}`, `URL: ${page.url ?? ""}`, ""];
    for (const item of Array.isArray(page.content) ? page.content : []) {
        if (typeof item.line === "number" && typeof item.text === "string")
            lines.push(`${item.line}  ${item.text}`);
    }
    const links = Array.isArray(page.links) ? page.links : [];
    if (links.length) {
        lines.push("", "Links:");
        for (const link of links.slice(0, 40)) {
            if (typeof link.id === "number" && typeof link.text === "string")
                lines.push(`[${link.id}] ${link.text}`);
        }
    }
    return lines.join("\n");
}
function pathViewImageDescriptionOutputFromJson(output) {
    let parsed;
    try {
        parsed = JSON.parse(output.trim());
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const description = parsed["description"];
    if (typeof description !== "string" || !description.trim())
        return undefined;
    const imageUrl = parsed["image_url"];
    const detail = parsed["detail"];
    return { description: description.trim(), ...(typeof imageUrl === "string" ? { image_url: imageUrl } : {}), ...(detail === "high" || detail === "original" ? { detail } : {}) };
}
export function pathImagegenOutputFromJson(output) {
    let parsed;
    try {
        parsed = JSON.parse(output.trim());
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const path = parsed["path"];
    if (typeof path !== "string" || !path)
        return undefined;
    return parsed;
}
export function imageContentsFromPathImagegenOutput(output) {
    const images = Array.isArray(output.images) ? output.images : [];
    return images.flatMap((image) => {
        const absolutePath = image.absolute_path;
        if (typeof absolutePath !== "string" || !absolutePath)
            return [];
        try {
            return [{ type: "image", mimeType: "image/png", data: readFileSync(absolutePath).toString("base64"), detail: "high" }];
        }
        catch {
            return [];
        }
    });
}
export function imageContentsFromPathToolDetails(details) {
    if (!details || typeof details !== "object")
        return [];
    const pathTool = details.pathTool;
    if (!pathTool || typeof pathTool !== "object")
        return [];
    const viewImageDescription = pathTool.viewImageDescription;
    if (viewImageDescription && typeof viewImageDescription === "object") {
        const image = viewImageDescription.image;
        if (isPathViewImageContent(image))
            return [image];
    }
    const imagegen = pathTool.imagegen;
    if (!imagegen || typeof imagegen !== "object")
        return [];
    return imageContentsFromPathImagegenOutput(imagegen);
}
export function viewImageDescriptionFromPathToolDetails(details) {
    if (!details || typeof details !== "object")
        return undefined;
    const pathTool = details.pathTool;
    if (!pathTool || typeof pathTool !== "object")
        return undefined;
    const viewImageDescription = pathTool.viewImageDescription;
    if (!viewImageDescription || typeof viewImageDescription !== "object")
        return undefined;
    const description = viewImageDescription.description;
    return typeof description === "string" && description.trim() ? description.trim() : undefined;
}
function isPathViewImageContent(value) {
    return Boolean(value && typeof value === "object"
        && value.type === "image"
        && typeof value.data === "string"
        && typeof value.mimeType === "string"
        && (value.detail === "high" || value.detail === "original"));
}
export function formatPathImagegenOutput(output) {
    const lines = [`Generated image: ${output.path}`];
    if (output.latest_path)
        lines.push(`Latest: ${output.latest_path}`);
    return lines.join("\n");
}
function formatPathApplyPatchOutput(result) {
    const output = result.output.trimEnd();
    if (result.exit_code === undefined || result.exit_code === 0)
        return output;
    return [`Process exited with code ${result.exit_code}`, output].filter(Boolean).join("\n");
}
function sanitizeExecResult(result, output, pathTool) {
    return { ...result, output, original_token_count: undefined, ...(pathTool === undefined ? {} : { pathTool }) };
}
