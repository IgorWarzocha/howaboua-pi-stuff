export const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
export const RESPONSES_LITE_WS_METADATA_KEY = "ws_request_header_x_openai_internal_codex_responses_lite";

export interface ResponsesLiteCompatibleBody {
	model: string;
	input: unknown[];
	instructions?: string | undefined;
	tools?: unknown[] | undefined;
	parallel_tool_calls?: boolean | undefined;
	reasoning?: unknown | undefined;
	client_metadata?: Record<string, string> | undefined;
	[key: string]: unknown;
}

export function supportsResponsesLiteModel(modelId: string | undefined): boolean {
	if (!modelId) return false;
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	return /^gpt-5\.6-(?:luna|terra|sol)$/.test(id.toLowerCase());
}

export function isResponsesLiteRequest(body: ResponsesLiteCompatibleBody): boolean {
	return isRecord(body.input[0]) && body.input[0]["type"] === "additional_tools";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prepareLiteContent(content: unknown): unknown {
	if (!Array.isArray(content)) return content;
	return content.map((item) => {
		if (!isRecord(item) || item["type"] !== "input_image") return item;
		const imageUrl = item["image_url"];
		if (typeof imageUrl === "string" && /^https?:\/\//i.test(imageUrl)) {
			return { type: "input_text", text: "image content omitted because remote image URLs are not supported" };
		}
		const { detail: _detail, ...image } = item;
		return image;
	});
}

function prepareLiteInput(input: readonly unknown[]): unknown[] {
	return input.map((item) => {
		if (!isRecord(item)) return item;
		if (item["type"] === "message" || item["role"] === "user" || item["role"] === "developer" || item["role"] === "system") {
			return { ...item, content: prepareLiteContent(item["content"]) };
		}
		if ((item["type"] === "function_call_output" || item["type"] === "custom_tool_call_output") && isRecord(item["output"])) {
			return { ...item, output: { ...item["output"], content: prepareLiteContent(item["output"]["content"]) } };
		}
		if (item["type"] === "function_call_output" && Array.isArray(item["output"])) {
			return { ...item, output: prepareLiteContent(item["output"]) };
		}
		return item;
	});
}

export function applyResponsesLiteRequest<TBody extends ResponsesLiteCompatibleBody>(body: TBody): TBody {
	const instructions = body.instructions?.trim();
	const prefix: unknown[] = [
		{ type: "additional_tools", role: "developer", tools: [...(body.tools ?? [])] },
		...(instructions ? [{ type: "message", role: "developer", content: [{ type: "input_text", text: instructions }] }] : []),
	];
	const { instructions: _instructions, tools: _tools, ...rest } = body;
	return {
		...rest,
		input: [...prefix, ...prepareLiteInput(body.input)],
		parallel_tool_calls: false,
		reasoning: { ...(isRecord(body.reasoning) ? body.reasoning : {}), context: "all_turns" },
	} as TBody;
}

export function applyResponsesLiteWebSocketMetadata<TBody extends ResponsesLiteCompatibleBody>(body: TBody): TBody & { client_metadata: Record<string, string> } {
	return {
		...body,
		client_metadata: { ...(body.client_metadata ?? {}), [RESPONSES_LITE_WS_METADATA_KEY]: "true" },
	};
}
