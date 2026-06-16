import { basename } from "node:path";
import { shellSplit, splitOnConnectors } from "../../shell/tokenize.ts";

interface RenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

type PathToolName = "view_image" | "web_run" | "imagegen";

export function renderPathToolCommandCall(command: string, theme: RenderTheme): string | undefined {
	const parsed = parsePathToolJsonCall(command);
	if (!parsed) return undefined;
	if (parsed.toolName === "view_image") {
		return renderPathToolCell("Viewed Image", firstString(parsed.params, "path") ?? firstString(parsed.params, "file_path") ?? firstString(parsed.params, "image_path"), theme);
	}
	if (parsed.toolName === "web_run") {
		const detail = webRunCallDetail(parsed.params);
		return renderPathToolCell(webRunCallTitle(parsed.params), detail, theme);
	}
	const action = firstString(parsed.params, "action");
	return renderPathToolCell(action === "edit" ? "Edited Image:" : "Generated Image:", firstString(parsed.params, "prompt"), theme);
}

function renderPathToolCell(title: string, detail: string | undefined, theme: RenderTheme): string {
	let text = `${theme.fg("dim", "•")} ${theme.bold(title)}`;
	if (detail?.trim()) {
		text += `\n${theme.fg("dim", "  └ ")}${theme.fg("accent", detail.trim())}`;
	}
	return text;
}

function parsePathToolJsonCall(command: string): { toolName: PathToolName; params: Record<string, unknown> } | undefined {
	return parseHeredocPathToolJsonCall(command) ?? parseArgvPathToolJsonCall(command);
}

function parseArgvPathToolJsonCall(command: string): { toolName: PathToolName; params: Record<string, unknown> } | undefined {
	let parts: string[][];
	try {
		parts = splitOnConnectors(shellSplit(command));
	} catch {
		return undefined;
	}
	if (parts.length !== 1) return undefined;
	const part = parts[0]!;
	const commandIndex = findPathToolCommandIndex(part);
	if (commandIndex === -1) return undefined;
	const toolName = pathToolNameFromToken(part[commandIndex]!);
	if (!toolName) return undefined;
	const arg = part[commandIndex + 1];
	if (!arg) return undefined;
	const params = parseJsonObject(arg);
	return params ? { toolName, params } : undefined;
}

function parseHeredocPathToolJsonCall(command: string): { toolName: PathToolName; params: Record<string, unknown> } | undefined {
	const lines = command.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const parsed = parsePathToolHeredocLine(lines[index]!);
		if (!parsed) continue;
		const endIndex = findHeredocEnd(lines, index + 1, parsed.delimiter, parsed.stripLeadingTabs);
		if (endIndex === -1) return undefined;
		const bodyLines = lines.slice(index + 1, endIndex);
		const body = parsed.stripLeadingTabs
			? bodyLines.map((line) => line.replace(/^\t+/, "")).join("\n")
			: bodyLines.join("\n");
		const params = parseJsonObject(body.trim());
		return params ? { toolName: parsed.toolName, params } : undefined;
	}
	return undefined;
}

function parsePathToolHeredocLine(line: string): { toolName: PathToolName; delimiter: string; stripLeadingTabs: boolean } | undefined {
	const match = line.match(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+\s+)*)?(?:[^\s;&|()]+\/)?(view_image|web_run|imagegen)\s+<<(-?)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*$/);
	if (!match) return undefined;
	const delimiter = match[3] ?? match[4] ?? match[5];
	if (!delimiter) return undefined;
	return { toolName: match[1]! as PathToolName, delimiter, stripLeadingTabs: match[2] === "-" };
}

function findHeredocEnd(lines: string[], startIndex: number, delimiter: string, stripLeadingTabs: boolean): number {
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = stripLeadingTabs ? lines[index]!.replace(/^\t+/, "") : lines[index]!;
		if (line === delimiter) return index;
	}
	return -1;
}

function findPathToolCommandIndex(tokens: string[]): number {
	let index = 0;
	while (index < tokens.length && isEnvAssignment(tokens[index]!)) index += 1;
	if (tokens[index] === "env") {
		index += 1;
		while (index < tokens.length && isEnvAssignment(tokens[index]!)) index += 1;
	}
	return pathToolNameFromToken(tokens[index] ?? "") ? index : -1;
}

function isEnvAssignment(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function pathToolNameFromToken(token: string): PathToolName | undefined {
	const name = basename(token.replace(/\\/g, "/"));
	return name === "view_image" || name === "web_run" || name === "imagegen" ? name : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function firstString(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function firstRecord(value: unknown, key: string): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") return undefined;
	const field = (value as Record<string, unknown>)[key];
	return Array.isArray(field) && field[0] && typeof field[0] === "object" ? field[0] as Record<string, unknown> : undefined;
}

function webRunCallTitle(params: Record<string, unknown>): string {
	if (firstRecord(params, "open")) return "Opened Web Page";
	if (firstRecord(params, "click")) return "Clicked Web Result";
	if (firstRecord(params, "find")) return "Searched Web Page";
	return "Searched the web";
}

function webRunCallDetail(params: Record<string, unknown>): string | undefined {
	const search = firstRecord(params, "search_query");
	const image = firstRecord(params, "image_query");
	const open = firstRecord(params, "open");
	const click = firstRecord(params, "click");
	const find = firstRecord(params, "find");
	const query = firstString(search, "q") ?? firstString(image, "q");
	if (query) return query;
	const opened = firstString(open, "url") ?? firstString(open, "ref_id") ?? firstString(click, "ref_id");
	if (opened) return opened;
	const pattern = firstString(find, "pattern");
	return pattern ? `'${pattern}'` : undefined;
}
