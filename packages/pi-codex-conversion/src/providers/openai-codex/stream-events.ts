import { processResponsesStream } from "../openai-responses-shared.ts";
import type { Api, AssistantMessage, AssistantMessageEventStream, Context, Model } from "@earendil-works/pi-ai";
import { CODEX_RESPONSE_STATUSES } from "./constants.ts";
import { normalizeImageOutputFormat, saveOpenAICodexGeneratedImage } from "./image-output.ts";
import { extractWebSearch } from "./activity.ts";
import { applyServiceTierPricing, resolveCodexServiceTier } from "./usage.ts";
import type { OpenAICodexStreamOptions, SavedGeneratedImage, ServiceTier, StreamEventShape, SurfacedWebSearch } from "./types.ts";

export async function* mapCodexEvents(events: AsyncIterable<StreamEventShape>): AsyncIterable<StreamEventShape> {
	let sawTerminalResponse = false;
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : undefined;
		if (!type) continue;

		if (type === "error") {
			throw new Error(`Codex error: ${event.message || event.code || JSON.stringify(event)}`);
		}

		if (type === "response.failed") {
			throw new Error(event.response?.error?.message || "Codex response failed");
		}

		if (type === "response.done" || type === "response.completed" || type === "response.incomplete") {
			sawTerminalResponse = true;
			const response = event.response;
			yield {
				...event,
				type: "response.completed",
				response: response ? { ...response, status: normalizeCodexStatus(response.status) } : response,
			};
			return;
		}

		yield event;
	}

	if (!sawTerminalResponse) {
		throw new Error("Stream closed before response.completed");
	}
}

function normalizeCodexStatus(status: string | undefined): string | undefined {
	if (typeof status !== "string") return undefined;
	return CODEX_RESPONSE_STATUSES.has(status) ? status : undefined;
}

export function getLatestUserText(context: Context): string | undefined {
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const message = context.messages[i]!;
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			const trimmed = message.content.trim();
			if (trimmed) return trimmed;
			continue;
		}
		const text = message.content
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}

export async function* captureGeneratedImages(
	events: AsyncIterable<StreamEventShape>,
	options: {
		cwd: string;
		requestPrompt?: string | undefined;
		onImageSaved: (image: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
): AsyncIterable<StreamEventShape> {
	let responseId: string | undefined;

	for await (const event of events) {
		if (event.type === "response.created" && event.response?.id) {
			responseId = event.response.id;
		}

		if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call") {
			const callId = typeof event.item.id === "string" ? event.item.id : undefined;
			const result = typeof event.item.result === "string" ? event.item.result : undefined;
			if (callId && result) {
				try {
					const outputFormat = typeof event.item.output_format === "string" ? event.item.output_format : undefined;
					const normalizedOutputFormat = normalizeImageOutputFormat(outputFormat);
					const saved = await saveOpenAICodexGeneratedImage(options.cwd, {
						responseId,
						callId,
						result,
						outputFormat: normalizedOutputFormat,
						revisedPrompt:
							typeof event.item.revised_prompt === "string" ? event.item.revised_prompt : options.requestPrompt,
					});
					options.onImageSaved(saved, {
						data: result,
						mimeType: `image/${normalizedOutputFormat}`,
					});
				} catch (error) {
					console.warn("[pi-codex-conversion] Failed to save generated image", error);
				}
			}
		}

		if (event.type === "response.output_item.done" && event.item?.type === "web_search_call") {
			const search = extractWebSearch(event.item);
			if (search) {
				options.onWebSearchCaptured?.(search);
			}
		}

		yield event;
	}
}

export async function processCapturedResponsesStream<TApi extends Api>(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options: OpenAICodexStreamOptions | undefined,
	deps: {
		onImageSaved?: (savedImage: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void | undefined;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
	cwd: string,
	requestPrompt: string | undefined,
): Promise<void> {
	const tappedEvents = captureGeneratedImages(mapCodexEvents(events), {
		cwd,
		requestPrompt,
		onImageSaved: (image, imageData) => deps.onImageSaved?.(image, imageData),
		onWebSearchCaptured: (search) => deps.onWebSearchCaptured?.(search),
	});

	await processResponsesStream(tappedEvents as AsyncIterable<never>, output, stream, model, {
		serviceTier: (options as { serviceTier?: ServiceTier | undefined } | undefined)?.serviceTier,
		resolveServiceTier: resolveCodexServiceTier,
		applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model as Model<Api>),
	});
}
