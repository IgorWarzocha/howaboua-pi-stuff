import { createHash } from "node:crypto";
import {
	registerSessionResourceCleanup,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { resizeImage } from "@earendil-works/pi-coding-agent";
import {
	namespaceResponsesLiteInputTools,
	namespaceResponsesLiteTools,
} from "./responses-lite-tools.ts";

export const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
const RESPONSES_LITE_WS_METADATA_KEY =
	"ws_request_header_x_openai_internal_codex_responses_lite";

const IMAGE_PROCESSING_PLACEHOLDER =
	"image content omitted because it could not be processed";
// Codex's unified image budget for Responses Lite models (ORIGINAL_DETAIL).
const IMAGE_MAX_DIMENSION = 6000;
const IMAGE_MAX_PATCHES = 10_000;
const IMAGE_PATCH_SIZE = 32;
const IMAGE_MAX_BASE64_BYTES = 64 * 1024 * 1024;

// Unchanged images need only a digest; retain bytes only for resized images.
type PreparedImage = string | true;
const PREPARED_IMAGE_CACHE_BYTES = 8 * 1024 * 1024;
const PREPARED_IMAGE_CACHE_ENTRIES = 256;
const PREPARED_IMAGE_CACHE_SESSIONS = 2;

function preparedImageBytes(image: PreparedImage): number {
	return image === true ? 0 : image.length * 2;
}

class PreparedImages {
	private readonly images = new Map<string, PreparedImage>();
	private bytes = 0;

	get(key: string): PreparedImage | undefined {
		const image = this.images.get(key);
		if (image !== undefined) {
			this.images.delete(key);
			this.images.set(key, image);
		}
		return image;
	}

	set(key: string, image: PreparedImage): void {
		// Count a conservative two bytes per JS string code unit.
		const bytes = preparedImageBytes(image);
		if (bytes > PREPARED_IMAGE_CACHE_BYTES || this.get(key) !== undefined)
			return;
		while (
			this.bytes + bytes > PREPARED_IMAGE_CACHE_BYTES ||
			this.images.size >= PREPARED_IMAGE_CACHE_ENTRIES
		) {
			const oldest = this.images.entries().next();
			if (oldest.done) break;
			const [oldKey, oldImage] = oldest.value;
			this.images.delete(oldKey);
			this.bytes -= preparedImageBytes(oldImage);
		}
		this.images.set(key, image);
		this.bytes += bytes;
	}
}

const preparedImagesBySession = new Map<string, PreparedImages>();
registerSessionResourceCleanup((sessionId) => {
	if (sessionId) preparedImagesBySession.delete(sessionId);
	else preparedImagesBySession.clear();
});

function preparedImagesForSession(sessionId: string): PreparedImages {
	const cached = preparedImagesBySession.get(sessionId);
	if (cached) preparedImagesBySession.delete(sessionId);
	const images = cached ?? new PreparedImages();
	preparedImagesBySession.set(sessionId, images);
	if (preparedImagesBySession.size > PREPARED_IMAGE_CACHE_SESSIONS) {
		const oldest = preparedImagesBySession.keys().next();
		if (!oldest.done) preparedImagesBySession.delete(oldest.value);
	}
	return images;
}

export function responsesLiteImageCacheSessionId(
	options?: Pick<SimpleStreamOptions, "cacheRetention" | "sessionId">,
): string | undefined {
	return options?.cacheRetention === "none" ? undefined : options?.sessionId;
}

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

export function isResponsesLiteRequest(
	body: ResponsesLiteCompatibleBody,
): boolean {
	return (
		body.instructions === undefined &&
		body.tools === undefined &&
		isRecord(body.input[0]) &&
		body.input[0]["type"] === "additional_tools"
	);
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
			return {
				type: "input_text",
				text: "image content omitted because remote image URLs are not supported",
			};
		}
		const { detail: _detail, ...image } = item;
		return image;
	});
}

function prepareLiteInput(input: readonly unknown[]): unknown[] {
	const prepared = input.map((item) => {
		if (!isRecord(item)) return item;
		if (
			item["type"] === "message" ||
			item["role"] === "user" ||
			item["role"] === "developer" ||
			item["role"] === "system"
		) {
			return { ...item, content: prepareLiteContent(item["content"]) };
		}
		if (
			(item["type"] === "function_call_output" ||
				item["type"] === "custom_tool_call_output") &&
			isRecord(item["output"])
		) {
			return {
				...item,
				output: {
					...item["output"],
					content: prepareLiteContent(item["output"]["content"]),
				},
			};
		}
		if (
			(item["type"] === "function_call_output" ||
				item["type"] === "custom_tool_call_output") &&
			Array.isArray(item["output"])
		) {
			return { ...item, output: prepareLiteContent(item["output"]) };
		}
		return item;
	});
	return namespaceResponsesLiteInputTools(prepared);
}

async function prepareDataImageUrl(
	imageUrl: string,
): Promise<string | undefined> {
	const match = /^data:([^;,]+);base64,([a-z0-9+/]*={0,2})$/i.exec(imageUrl);
	if (!match?.[1] || !match[2] || !match[1].toLowerCase().startsWith("image/"))
		return undefined;
	if (Buffer.byteLength(match[2], "utf8") > IMAGE_MAX_BASE64_BYTES)
		return undefined;
	try {
		const bytes = Buffer.from(match[2], "base64");
		if (bytes.length === 0) return undefined;
		let resized = await resizeImage(bytes, match[1], {
			maxWidth: IMAGE_MAX_DIMENSION,
			maxHeight: IMAGE_MAX_DIMENSION,
			maxBytes: IMAGE_MAX_BASE64_BYTES,
		});
		if (!resized) return undefined;
		const patches =
			Math.ceil(resized.width / IMAGE_PATCH_SIZE) *
			Math.ceil(resized.height / IMAGE_PATCH_SIZE);
		if (patches > IMAGE_MAX_PATCHES) {
			const wide = resized.width / IMAGE_PATCH_SIZE;
			const high = resized.height / IMAGE_PATCH_SIZE;
			let scale = Math.sqrt(IMAGE_MAX_PATCHES / wide / high);
			const scaledWide = wide * scale;
			const scaledHigh = high * scale;
			// Round down the scaled patch grid as Codex does, so partial
			// patches at both edges still fit the budget.
			scale *= Math.min(
				Math.floor(scaledWide) / scaledWide,
				Math.floor(scaledHigh) / scaledHigh,
			);
			resized = await resizeImage(bytes, match[1], {
				maxWidth: Math.max(1, Math.floor(resized.width * scale)),
				maxHeight: Math.max(1, Math.floor(resized.height * scale)),
				maxBytes: IMAGE_MAX_BASE64_BYTES,
			});
		}
		if (
			resized &&
			!resized.wasResized &&
			resized.mimeType === match[1] &&
			resized.data === match[2]
		)
			return imageUrl;
		return resized
			? `data:${resized.mimeType};base64,${resized.data}`
			: undefined;
	} catch {
		return undefined;
	}
}

function imagePreparer(sessionId?: string) {
	let cachedImages: PreparedImages | undefined;
	let pendingResize = Promise.resolve();
	const preparedThisRequest = new Map<string, Promise<string | undefined>>();
	const resizeSerially = (imageUrl: string) => {
		// Each Pi resize starts a decoding worker and copies the source buffer.
		// A cold replay must not start one worker for every image in history.
		const prepared = pendingResize.then(() => prepareDataImageUrl(imageUrl));
		pendingResize = prepared.then(
			() => undefined,
			() => undefined,
		);
		return prepared;
	};
	return (imageUrl: string): Promise<string | undefined> => {
		const existing = preparedThisRequest.get(imageUrl);
		if (existing) return existing;
		const prepared = (async () => {
			if (!sessionId) return resizeSerially(imageUrl);
			// Exact input includes MIME type and base64 spelling. Reuse the final
			// successful conversion without retaining the unprocessed URL.
			const hash = createHash("sha256");
			// Hash bounded chunks; a single string-to-bytes conversion can allocate
			// another full-size copy of a large data URL.
			const chunkSize = 64 * 1024;
			for (let start = 0; start < imageUrl.length; start += chunkSize)
				hash.update(imageUrl.slice(start, start + chunkSize), "utf16le");
			const key = hash.digest("base64url");
			const cache = (cachedImages ??= preparedImagesForSession(sessionId));
			const cached = cache.get(key);
			if (cached !== undefined) return cached === true ? imageUrl : cached;
			const result = await resizeSerially(imageUrl);
			if (result !== undefined)
				cache.set(key, result === imageUrl ? true : result);
			return result;
		})();
		preparedThisRequest.set(imageUrl, prepared);
		return prepared;
	};
}

async function prepareLiteImageContent(
	content: unknown,
	prepareImage: ReturnType<typeof imagePreparer>,
): Promise<unknown> {
	if (!Array.isArray(content)) return content;
	return Promise.all(
		content.map(async (item) => {
			if (
				!isRecord(item) ||
				item["type"] !== "input_image" ||
				typeof item["image_url"] !== "string"
			)
				return item;
			if (!/^data:/i.test(item["image_url"])) return item;
			const imageUrl = await prepareImage(item["image_url"]);
			return imageUrl
				? { ...item, image_url: imageUrl }
				: { type: "input_text", text: IMAGE_PROCESSING_PLACEHOLDER };
		}),
	);
}

async function prepareResponsesLiteInputImages(
	input: readonly unknown[],
	sessionId?: string,
): Promise<unknown[]> {
	const prepareImage = imagePreparer(sessionId);
	return Promise.all(
		input.map(async (item) => {
			if (!isRecord(item)) return item;
			if (
				(item["type"] === "message" ||
					item["role"] === "user" ||
					item["role"] === "developer" ||
					item["role"] === "system") &&
				"content" in item
			) {
				return {
					...item,
					content: await prepareLiteImageContent(item["content"], prepareImage),
				};
			}
			if (
				(item["type"] === "function_call_output" ||
					item["type"] === "custom_tool_call_output") &&
				isRecord(item["output"])
			) {
				return {
					...item,
					output: {
						...item["output"],
						content: await prepareLiteImageContent(
							item["output"]["content"],
							prepareImage,
						),
					},
				};
			}
			if (
				(item["type"] === "function_call_output" ||
					item["type"] === "custom_tool_call_output") &&
				Array.isArray(item["output"])
			) {
				return {
					...item,
					output: await prepareLiteImageContent(item["output"], prepareImage),
				};
			}
			return item;
		}),
	);
}

export async function prepareResponsesLiteConversationInput(
	input: readonly unknown[],
	sessionId?: string,
): Promise<unknown[]> {
	return prepareResponsesLiteInputImages(prepareLiteInput(input), sessionId);
}

export async function prepareResponsesLiteRequestImages<
	TBody extends ResponsesLiteCompatibleBody,
>(body: TBody, sessionId?: string): Promise<TBody> {
	return {
		...body,
		input: await prepareResponsesLiteInputImages(body.input, sessionId),
	};
}

export function applyResponsesLiteRequest<
	TBody extends ResponsesLiteCompatibleBody,
>(body: TBody): TBody {
	const instructions = body.instructions;
	const tools = [...(body.tools ?? [])];
	const prefix: unknown[] = [
		{
			type: "additional_tools",
			role: "developer",
			tools: namespaceResponsesLiteTools(tools),
		},
		...(instructions !== undefined && instructions.length > 0
			? [
					{
						type: "message",
						role: "developer",
						content: [{ type: "input_text", text: instructions }],
					},
				]
			: []),
	];
	const { instructions: _instructions, tools: _tools, ...rest } = body;
	return {
		...rest,
		input: [...prefix, ...prepareLiteInput(body.input)],
		parallel_tool_calls: false,
		reasoning: {
			...(isRecord(body.reasoning) ? body.reasoning : {}),
			context: "all_turns",
		},
	} as TBody;
}

export function namespaceExistingResponsesLiteRequest<
	TBody extends ResponsesLiteCompatibleBody,
>(body: TBody): TBody {
	return { ...body, input: namespaceResponsesLiteInputTools(body.input) };
}

export function applyResponsesLiteWebSocketMetadata<
	TBody extends ResponsesLiteCompatibleBody,
>(body: TBody): TBody & { client_metadata: Record<string, string> } {
	return {
		...body,
		client_metadata: {
			...(body.client_metadata ?? {}),
			[RESPONSES_LITE_WS_METADATA_KEY]: "true",
		},
	};
}
