import { resizeImage } from "@earendil-works/pi-coding-agent";

export const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
export const RESPONSES_LITE_WS_METADATA_KEY = "ws_request_header_x_openai_internal_codex_responses_lite";

const IMAGE_PROCESSING_PLACEHOLDER = "image content omitted because it could not be processed";
const IMAGE_MAX_DIMENSION = 2048;
const IMAGE_MAX_PATCHES = 2_500;
const IMAGE_PATCH_SIZE = 32;
const IMAGE_MAX_BASE64_BYTES = 64 * 1024 * 1024;

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

type ResponsesLiteModel = string | { id: string } | undefined;

export function supportsResponsesLiteModel(model: ResponsesLiteModel): boolean {
	return /^gpt-5\.6-(?:luna|terra|sol)$/.test(normalizeModelId(model));
}

function normalizeModelId(model: ResponsesLiteModel): string {
	const modelId = typeof model === "string" ? model : model?.id;
	if (!modelId) return "";
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	return id.toLowerCase();
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
		if ((item["type"] === "function_call_output" || item["type"] === "custom_tool_call_output") && Array.isArray(item["output"])) {
			return { ...item, output: prepareLiteContent(item["output"]) };
		}
		return item;
	});
}

async function prepareDataImageUrl(imageUrl: string): Promise<string | undefined> {
	const match = /^data:([^;,]+);base64,([a-z0-9+/]*={0,2})$/i.exec(imageUrl);
	if (!match?.[1] || !match[2] || !match[1].toLowerCase().startsWith("image/")) return undefined;
	if (Buffer.byteLength(match[2], "utf8") > IMAGE_MAX_BASE64_BYTES) return undefined;
	try {
		const bytes = Buffer.from(match[2], "base64");
		if (bytes.length === 0) return undefined;
		let resized = await resizeImage(bytes, match[1], {
			maxWidth: IMAGE_MAX_DIMENSION,
			maxHeight: IMAGE_MAX_DIMENSION,
			maxBytes: IMAGE_MAX_BASE64_BYTES,
		});
		if (!resized) return undefined;
		const patches = Math.ceil(resized.width / IMAGE_PATCH_SIZE) * Math.ceil(resized.height / IMAGE_PATCH_SIZE);
		if (patches > IMAGE_MAX_PATCHES) {
			const scale = Math.sqrt(IMAGE_MAX_PATCHES / patches);
			resized = await resizeImage(bytes, match[1], {
				maxWidth: Math.max(1, Math.floor(resized.width * scale)),
				maxHeight: Math.max(1, Math.floor(resized.height * scale)),
				maxBytes: IMAGE_MAX_BASE64_BYTES,
			});
		}
		return resized ? `data:${resized.mimeType};base64,${resized.data}` : undefined;
	} catch {
		return undefined;
	}
}

async function prepareLiteImageContent(content: unknown): Promise<unknown> {
	if (!Array.isArray(content)) return content;
	return Promise.all(content.map(async (item) => {
		if (!isRecord(item) || item["type"] !== "input_image" || typeof item["image_url"] !== "string") return item;
		if (!/^data:/i.test(item["image_url"])) return item;
		const imageUrl = await prepareDataImageUrl(item["image_url"]);
		return imageUrl ? { ...item, image_url: imageUrl } : { type: "input_text", text: IMAGE_PROCESSING_PLACEHOLDER };
	}));
}

export async function prepareResponsesLiteRequestImages<TBody extends ResponsesLiteCompatibleBody>(body: TBody): Promise<TBody> {
	const input = await Promise.all(body.input.map(async (item) => {
		if (!isRecord(item)) return item;
		if ((item["type"] === "message" || item["role"] === "user" || item["role"] === "developer" || item["role"] === "system") && "content" in item) {
			return { ...item, content: await prepareLiteImageContent(item["content"]) };
		}
		if ((item["type"] === "function_call_output" || item["type"] === "custom_tool_call_output") && isRecord(item["output"])) {
			return { ...item, output: { ...item["output"], content: await prepareLiteImageContent(item["output"]["content"]) } };
		}
		if ((item["type"] === "function_call_output" || item["type"] === "custom_tool_call_output") && Array.isArray(item["output"])) {
			return { ...item, output: await prepareLiteImageContent(item["output"]) };
		}
		return item;
	}));
	return { ...body, input };
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
