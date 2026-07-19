import { formatCustomToolHelp } from "./custom-tool-prompt.js";
import type {
	CodeModeToolDefinition,
	CustomToolDefinition,
	RuntimeContentItem,
	RuntimeResponse,
} from "./types.js";

export const MAX_CODE_MODE_OUTPUT_TOKENS = 100_000;
export const DEFAULT_CODE_MODE_OUTPUT_TOKENS = 10_000;

export function toWireToolDefinition(tool: CodeModeToolDefinition) {
	if (
		!isCustomToolDefinition(tool) &&
		tool.kind === "function" &&
		!tool.inputSchema
	)
		throw new Error(
			`Function code-mode tool requires inputSchema: ${tool.name}`,
		);
	return {
		name: tool.name,
		tool_name: { name: tool.name, namespace: null },
		description: formatCustomToolHelp(tool),
		kind: isCustomToolDefinition(tool) ? "freeform" : tool.kind,
		input_schema:
			isCustomToolDefinition(tool) || tool.kind === "freeform"
				? null
				: (tool.inputSchema ?? null),
		output_schema: null,
	};
}

export function isCustomToolDefinition(
	tool: CodeModeToolDefinition,
): tool is CustomToolDefinition {
	return "command" in tool;
}

export function parseExecSource(source: string): {
	code: string;
	yieldTimeMs: number | null;
	maxOutputTokens: number | null;
} {
	if (!source.trim())
		throw new Error("exec requires non-empty JavaScript source");
	const [first, ...rest] = source.split("\n");
	const trimmed = first?.trimStart() ?? "";
	if (!trimmed.startsWith("// @exec:"))
		return { code: source, yieldTimeMs: null, maxOutputTokens: null };
	if (rest.join("\n").trim() === "")
		throw new Error("exec pragma must be followed by JavaScript source");
	const options = JSON.parse(
		trimmed.slice("// @exec:".length).trim(),
	) as Record<string, unknown>;
	for (const key of Object.keys(options))
		if (key !== "yield_time_ms" && key !== "max_output_tokens")
			throw new Error(`Unsupported exec pragma field: ${key}`);
	return {
		code: rest.join("\n"),
		yieldTimeMs: parseInteger(options["yield_time_ms"], "yield_time_ms"),
		maxOutputTokens: parseInteger(
			options["max_output_tokens"],
			"max_output_tokens",
			1,
			MAX_CODE_MODE_OUTPUT_TOKENS,
		),
	};
}

export function parseRuntimeResponse(value: unknown): RuntimeResponse {
	if (!isRecord(value))
		throw new Error("Code-mode host returned an invalid runtime response");
	const kind = isRecord(value["Yielded"])
		? "yielded"
		: isRecord(value["Terminated"])
			? "terminated"
			: isRecord(value["Result"])
				? "result"
				: undefined;
	if (!kind)
		throw new Error("Code-mode host returned an invalid runtime response");
	const body = value[
		kind === "yielded"
			? "Yielded"
			: kind === "terminated"
				? "Terminated"
				: "Result"
	];
	if (!isRecord(body) || typeof body["cell_id"] !== "string")
		throw new Error("Code-mode host returned an invalid runtime response");
	const contentItems = parseContentItems(body["content_items"]);
	return {
		kind,
		cellId: body["cell_id"],
		contentItems,
		...(kind === "result" && typeof body["error_text"] === "string"
			? { errorText: body["error_text"] }
			: {}),
	};
}

function parseContentItems(value: unknown): RuntimeContentItem[] {
	if (value === undefined) return [];
	if (!Array.isArray(value))
		throw new Error("Code-mode host returned invalid content items");
	return value.map((item) => {
		if (!isRecord(item))
			throw new Error("Code-mode host returned an invalid content item");
		if (item["type"] === "input_text" && typeof item["text"] === "string")
			return { type: "input_text", text: item["text"] };
		if (
			item["type"] === "input_image" &&
			typeof item["image_url"] === "string" &&
			isImageDetail(item["detail"])
		)
			return {
				type: "input_image",
				image_url: item["image_url"],
				...(item["detail"] === undefined ? {} : { detail: item["detail"] }),
			};
		throw new Error("Code-mode host returned an invalid content item");
	});
}

function isImageDetail(
	value: unknown,
): value is "auto" | "low" | "high" | "original" | null | undefined {
	return value === undefined || value === null ||
		value === "auto" || value === "low" || value === "high" || value === "original";
}

function parseInteger(
	value: unknown,
	name: string,
	minimum = 0,
	maximum = Number.MAX_SAFE_INTEGER,
): number | null {
	if (value === undefined) return null;
	if (
		!Number.isSafeInteger(value) ||
		Number(value) < minimum ||
		Number(value) > maximum
	)
		throw new Error(
			`${name} must be a safe integer from ${minimum} to ${maximum}`,
		);
	return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type HostMessage =
	| { type: "connection/ready"; selectedVersion: 1; capabilities: string[] }
	| { type: "connection/rejected"; reason: unknown }
	| { type: "operation/response"; id: number; result: HostResult }
	| { type: "execute/initialResponse"; id: number; result: HostResult }
	| ({ type: "delegate/request" } & DelegateRequestMessage)
	| { type: "delegate/cancel"; id: number }
	| { type: "cell/closed"; cellId: string };

export interface DelegateRequestMessage {
	id: number;
	request:
		| { type: "notification/send"; cellId: string; text: string }
		| {
			type: "tool/invoke";
			invocation: {
				cell_id: string;
				input?: unknown;
				runtime_tool_call_id: string;
				tool_name: { name: string };
			};
		};
}

export type HostResult =
	| { status: "ok"; value: unknown }
	| { status: "error"; message: string };

export function parseHostMessage(value: unknown): HostMessage {
	if (!isRecord(value) || typeof value["type"] !== "string")
		throw new Error("Code-mode host returned an invalid message");
	const type = value["type"];
	if (type === "connection/ready") {
		if (
			value["selectedVersion"] !== 1 ||
			!isStringArray(value["capabilities"])
		)
			throw new Error("Code-mode host negotiated an invalid protocol");
		return { type, selectedVersion: 1, capabilities: value["capabilities"] };
	}
	if (type === "connection/rejected")
		return { type, reason: value["reason"] };
	if (type === "operation/response" || type === "execute/initialResponse")
		return { type, id: parseMessageId(value["id"]), result: parseHostResult(value["result"]) };
	if (type === "delegate/cancel")
		return { type, id: parseMessageId(value["id"]) };
	if (type === "cell/closed") {
		if (typeof value["cellId"] !== "string")
			throw new Error("Code-mode host returned an invalid cell closure");
		return { type, cellId: value["cellId"] };
	}
	if (type === "delegate/request")
		return { type, ...parseDelegateRequest(value) };
	throw new Error(`Code-mode host returned an unsupported message: ${type}`);
}

export function executionCellId(value: unknown): string | undefined {
	return isRecord(value) && value["type"] === "execution/started" &&
		typeof value["cellId"] === "string"
		? value["cellId"]
		: undefined;
}

export function runtimeOutcome(value: unknown): unknown {
	if (!isRecord(value) || !isRecord(value["outcome"])) return undefined;
	return value["outcome"]["LiveCell"] ?? value["outcome"]["MissingCell"];
}

export function isMissingRuntimeOutcome(value: unknown): boolean {
	return Boolean(
		isRecord(value) &&
			isRecord(value["outcome"]) &&
			"MissingCell" in value["outcome"],
	);
}

function parseDelegateRequest(value: Record<string, unknown>): DelegateRequestMessage {
	const id = parseMessageId(value["id"]);
	const request = value["request"];
	if (!isRecord(request) || typeof request["type"] !== "string")
		throw new Error("Code-mode host returned an invalid delegate request");
	if (request["type"] === "notification/send") {
		if (typeof request["cellId"] !== "string" || typeof request["text"] !== "string")
			throw new Error("Code-mode host returned an invalid notification");
		return { id, request: { type: "notification/send", cellId: request["cellId"], text: request["text"] } };
	}
	if (request["type"] !== "tool/invoke" || !isRecord(request["invocation"]))
		throw new Error("Code-mode host returned an invalid tool invocation");
	const invocation = request["invocation"];
	const toolName = invocation["tool_name"];
	if (
		typeof invocation["cell_id"] !== "string" ||
		typeof invocation["runtime_tool_call_id"] !== "string" ||
		!isRecord(toolName) ||
		typeof toolName["name"] !== "string"
	)
		throw new Error("Code-mode host returned an invalid tool invocation");
	return {
		id,
		request: {
			type: "tool/invoke",
			invocation: {
				cell_id: invocation["cell_id"],
				runtime_tool_call_id: invocation["runtime_tool_call_id"],
				tool_name: { name: toolName["name"] },
				...(invocation["input"] === undefined ? {} : { input: invocation["input"] }),
			},
		},
	};
}

function parseHostResult(value: unknown): HostResult {
	if (!isRecord(value))
		throw new Error("Code-mode host returned an invalid operation result");
	if (value["status"] === "ok") return { status: "ok", value: value["value"] };
	if (value["status"] === "error" && typeof value["message"] === "string")
		return { status: "error", message: value["message"] };
	throw new Error("Code-mode host returned an invalid operation result");
}

function parseMessageId(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new Error("Code-mode host returned an invalid message id");
	return Number(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
