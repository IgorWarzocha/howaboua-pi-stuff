import type { Model } from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import type { UnifiedExecResult } from "../exec/session-manager.ts";
import { formatUnifiedExecResult } from "../exec/format.ts";
import { shellSplit, splitOnConnectors } from "../../shell/tokenize.ts";

export type PathViewImageContent = { type: "image"; data: string; mimeType: string; detail: "high" | "original" };

type ToolContent = { type: "text"; text: string } | PathViewImageContent;

export interface ToolResultLike {
	content: ToolContent[];
	details: UnifiedExecResult & { pathTool?: unknown };
}

export interface PathToolPolicy {
	disableTruncation: boolean;
	suppressPartials: boolean;
	yieldTimeMs?: number | undefined;
	parseImageOutput: boolean;
	parseWebRunOutput: boolean;
	parseImagegenOutput: boolean;
	parseApplyPatchOutput: boolean;
}

export function getPathToolPolicy(command: string, model: Model<any> | undefined): PathToolPolicy | undefined {
	if (getPathToolNamesFromParts(splitCommandParts(command), ["apply_patch", "view_image", "web_run", "imagegen"]).length > 1) return undefined;
	const modelInput = model?.input;
	const parseApplyPatchOutput = isPathApplyPatchCommand(command);
	const parseImageOutput = isPathViewImageCommand(command) && (!Array.isArray(modelInput) || modelInput.includes("image"));
	const parseWebRunOutput = isPathWebRunCommand(command);
	const parseImagegenOutput = isPathImagegenCommand(command) && (!Array.isArray(modelInput) || modelInput.includes("image"));
	if (!parseApplyPatchOutput && !parseImageOutput && !parseWebRunOutput && !parseImagegenOutput) return undefined;
	return { disableTruncation: true, suppressPartials: true, ...(parseWebRunOutput || parseImagegenOutput ? { yieldTimeMs: 300_000 } : {}), parseApplyPatchOutput, parseImageOutput, parseWebRunOutput, parseImagegenOutput };
}

export function convertPathToolExecResult(command: string, result: UnifiedExecResult, policy: PathToolPolicy | undefined): ToolResultLike | undefined {
	if (!policy || result.session_id !== undefined) return undefined;
	if (policy.parseApplyPatchOutput) {
		const details = sanitizeExecResult(result, result.output);
		return { content: [{ type: "text", text: formatPathApplyPatchOutput(details) }], details };
	}
	if (result.exit_code !== 0) return undefined;
	if (policy.parseImageOutput) {
		const imageContents = imageContentsFromCodexViewImageOutput(result.output);
		if (imageContents.length) {
			const details = sanitizeExecResult(result, "<image output>");
			return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }, ...imageContents], details };
		}
		const details = sanitizeExecResult(result, "view_image returned image-like output, but Pi could not convert it to structured image content. Raw output hidden.");
		return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }], details };
	}
	if (policy.parseWebRunOutput) {
		const parsed = pathWebRunOutputFromJson(result.output);
		if (parsed) {
			const details = sanitizeExecResult(result, formatPathWebRunOutput(parsed), { webRun: parsed });
			return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }], details };
		}
		const details = sanitizeExecResult(result, "web_run returned output, but Pi could not parse it. Raw output hidden.");
		return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }], details };
	}
	if (policy.parseImagegenOutput) {
		const parsed = pathImagegenOutputFromJson(result.output);
		if (parsed) {
			const imageContents = imageContentsFromPathImagegenOutput(parsed);
			const details = sanitizeExecResult(result, formatPathImagegenOutput(parsed), { imagegen: parsed });
			return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }, ...imageContents], details };
		}
		const details = sanitizeExecResult(result, "imagegen returned output, but Pi could not parse it. Raw output hidden.");
		return { content: [{ type: "text", text: formatUnifiedExecResult(details, command) }], details };
	}
	return undefined;
}

export function imageContentFromCodexViewImageOutput(output: string): PathViewImageContent | undefined {
	return imageContentsFromCodexViewImageOutput(output)[0];
}

export function imageContentsFromCodexViewImageOutput(output: string): PathViewImageContent[] {
	const trimmed = output.trim();
	if (!trimmed) return [];
	const whole = imageContentFromCodexViewImageJson(trimmed);
	if (whole) return [whole];
	return trimmed.split(/\r?\n/).flatMap((line) => {
		const image = imageContentFromCodexViewImageJson(line.trim());
		return image ? [image] : [];
	});
}

function imageContentFromCodexViewImageJson(json: string): PathViewImageContent | undefined {
	let parsed: unknown;
	try { parsed = JSON.parse(json); } catch { return undefined; }
	if (!parsed || typeof parsed !== "object") return undefined;
	const imageUrl = (parsed as Record<string, unknown>)["image_url"];
	const detail = (parsed as Record<string, unknown>)["detail"];
	if (typeof imageUrl !== "string" || (detail !== "high" && detail !== "original")) return undefined;
	const match = imageUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
	if (!match) return undefined;
	return { type: "image", mimeType: match[1]!, data: match[2]!, detail };
}

function isPathViewImageCommand(command: string): boolean {
	return hasPathToolCommand(command, "view_image");
}

function isPathApplyPatchCommand(command: string): boolean {
	return hasPathToolCommand(command, "apply_patch");
}

function isPathWebRunCommand(command: string): boolean {
	return hasPathToolCommand(command, "web_run");
}

function isPathImagegenCommand(command: string): boolean {
	return hasPathToolCommand(command, "imagegen");
}

export function getCodexBackedPathToolNames(command: string): string[] {
	return [
		...(isPathWebRunCommand(command) ? ["web_run"] : []),
		...(isPathImagegenCommand(command) ? ["imagegen"] : []),
	];
}

function hasPathToolCommand(command: string, toolName: string): boolean {
	return getPathToolNamesFromParts(splitCommandParts(command), [toolName]).includes(toolName);
}

function getPathToolNamesFromParts(parts: string[][], toolNames: string[]): string[] {
	const found = new Set<string>();
	for (const part of parts) {
		if (isPathToolDiscoveryPart(part)) continue;
		for (const toolName of toolNames) {
			if (partHasPathToolCommand(part, toolName)) found.add(toolName);
		}
	}
	return [...found];
}

function splitCommandParts(command: string): string[][] {
	try {
		return splitOnConnectors(shellSplit(command)).filter((part) => part.length > 0);
	} catch {
		return [[command]];
	}
}

function partHasPathToolCommand(part: string[], toolName: string): boolean {
	const command = part.join(" ");
	const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?:^|[;&|()\r\n])\\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\\s;&|()]+\\s+)*(?:env\\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\\s;&|()]+\\s+)*)?(?:[^\\s;&|()]+/)?${escaped}(?:\\s|$)`).test(command);
}

function isPathToolDiscoveryPart(part: string[]): boolean {
	if (part[0] === "which") return part.length >= 2 && ["apply_patch", "view_image", "web_run", "imagegen"].includes(part[1]!);
	return part[0] === "command" && part[1] === "-v" && part.length >= 3 && ["apply_patch", "view_image", "web_run", "imagegen"].includes(part[2]!);
}

interface PathWebRunOutput {
	text?: string;
	output_text?: string;
	search_results?: Array<{ ref_id?: string; title?: string; url?: string; source?: string }>;
	ref_id?: string;
	title?: string;
	url?: string;
	content?: Array<{ line?: number; text?: string }>;
	links?: Array<{ id?: number; text?: string; url?: string }>;
	open?: Array<{ ref_id?: string; title?: string; url?: string; content?: Array<{ line?: number; text?: string }>; links?: Array<{ id?: number; text?: string; url?: string }> }>;
	citations?: Array<{ title?: string; url?: string }>;
	web_search_calls?: unknown[];
	response_id?: string | null;
	usage?: unknown;
	encrypted_output?: string;
}

function pathWebRunOutputFromJson(output: string): PathWebRunOutput | undefined {
	let parsed: unknown;
	try { parsed = JSON.parse(output.trim()); } catch { return undefined; }
	if (!parsed || typeof parsed !== "object") return undefined;
	const record = parsed as Record<string, unknown>;
	const text = record["text"] ?? record["output_text"];
	if (typeof text !== "string" && typeof record["encrypted_output"] !== "string" && !Array.isArray(record["search_results"]) && !Array.isArray(record["content"]) && !Array.isArray(record["open"])) return undefined;
	return parsed as PathWebRunOutput;
}

function formatPathWebRunOutput(output: PathWebRunOutput): string {
	if (Array.isArray(output.content)) return formatPathWebRunPage(output);
	if (Array.isArray(output.open) && output.open.length === 1) return formatPathWebRunPage(output.open[0]!);
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

function formatPathWebRunPage(page: NonNullable<PathWebRunOutput["open"]>[number] | PathWebRunOutput): string {
	const lines = [`Title: ${page.title ?? "(untitled)"}`, `URL: ${page.url ?? ""}`, ""];
	for (const item of Array.isArray(page.content) ? page.content : []) {
		if (typeof item.line === "number" && typeof item.text === "string") lines.push(`${item.line}  ${item.text}`);
	}
	const links = Array.isArray(page.links) ? page.links : [];
	if (links.length) {
		lines.push("", "Links:");
		for (const link of links.slice(0, 40)) {
			if (typeof link.id === "number" && typeof link.text === "string") lines.push(`[${link.id}] ${link.text}`);
		}
	}
	return lines.join("\n");
}

export interface PathImagegenOutput {
	path: string;
	latest_path?: string | undefined;
	images?: Array<{ path?: string | undefined; absolute_path?: string | undefined; latest_path?: string | undefined; latest_absolute_path?: string | undefined }> | undefined;
	background?: string | undefined;
	quality?: string | undefined;
	size?: string | undefined;
}

export function pathImagegenOutputFromJson(output: string): PathImagegenOutput | undefined {
	let parsed: unknown;
	try { parsed = JSON.parse(output.trim()); } catch { return undefined; }
	if (!parsed || typeof parsed !== "object") return undefined;
	const path = (parsed as Record<string, unknown>)["path"];
	if (typeof path !== "string" || !path) return undefined;
	return parsed as PathImagegenOutput;
}

export function imageContentsFromPathImagegenOutput(output: PathImagegenOutput): PathViewImageContent[] {
	const images = Array.isArray(output.images) ? output.images : [];
	return images.flatMap((image) => {
		const absolutePath = image.absolute_path;
		if (typeof absolutePath !== "string" || !absolutePath) return [];
		try {
			return [{ type: "image" as const, mimeType: "image/png", data: readFileSync(absolutePath).toString("base64"), detail: "high" as const }];
		} catch {
			return [];
		}
	});
}

export function formatPathImagegenOutput(output: PathImagegenOutput): string {
	const lines = [`Generated image: ${output.path}`];
	if (output.latest_path) lines.push(`Latest: ${output.latest_path}`);
	return lines.join("\n");
}

function formatPathApplyPatchOutput(result: UnifiedExecResult): string {
	const output = result.output.trimEnd();
	if (result.exit_code === undefined || result.exit_code === 0) return output;
	return [`Process exited with code ${result.exit_code}`, output].filter(Boolean).join("\n");
}

function sanitizeExecResult(result: UnifiedExecResult, output: string, pathTool?: unknown): UnifiedExecResult & { pathTool?: unknown } {
	return { ...result, output, original_token_count: undefined, ...(pathTool === undefined ? {} : { pathTool }) };
}
