import { processResponsesStream } from "../openai-responses/shared.ts";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { CODEX_RESPONSE_STATUSES } from "./constants.ts";
import { applyServiceTierPricing, resolveCodexServiceTier } from "./usage.ts";
import type { OpenAICodexStreamOptions, ServiceTier, StreamEventShape } from "./types.ts";

const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached";

export class CodexApiError extends Error {
	readonly code?: string | undefined;
	readonly payload?: StreamEventShape | undefined;

	constructor(message: string, options?: { code?: string | undefined; payload?: StreamEventShape | undefined }) {
		super(message);
		this.name = "CodexApiError";
		this.code = options?.code;
		this.payload = options?.payload;
	}
}

export function isWebSocketConnectionLimitReachedError(error: unknown): boolean {
	return error instanceof CodexApiError && error.code === WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE;
}

function extractCodexEventError(event: StreamEventShape): { code?: string | undefined; message?: string | undefined } {
	const nested = event["error"] && typeof event["error"] === "object" ? event["error"] as Record<string, unknown> : undefined;
	return {
		code: typeof event.code === "string" ? event.code : typeof nested?.["code"] === "string" ? nested["code"] : undefined,
		message: typeof event.message === "string" ? event.message : typeof nested?.["message"] === "string" ? nested["message"] : undefined,
	};
}

export async function* mapCodexEvents(events: AsyncIterable<StreamEventShape>): AsyncIterable<StreamEventShape> {
	let sawTerminalResponse = false;
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : undefined;
		if (!type) continue;

		if (type === "error") {
			const { code, message } = extractCodexEventError(event);
			throw new CodexApiError(`Codex error: ${message || code || JSON.stringify(event)}`, { code, payload: event });
		}

		if (type === "response.failed") {
			const code = typeof event.response?.error === "object" ? (event.response.error as { code?: string | undefined }).code : undefined;
			throw new CodexApiError(event.response?.error?.message || "Codex response failed", { code, payload: event });
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

function responseStreamOptions<TApi extends Api>(options: OpenAICodexStreamOptions | undefined, model: Model<TApi>) {
	return {
		serviceTier: (options as { serviceTier?: ServiceTier | undefined } | undefined)?.serviceTier,
		resolveServiceTier: resolveCodexServiceTier,
		applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model as Model<Api>),
	} satisfies Parameters<typeof processResponsesStream>[4];
}

export async function processMappedCodexResponsesStream<TApi extends Api>(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options: OpenAICodexStreamOptions | undefined,
): Promise<void> {
	await processResponsesStream(events as AsyncIterable<never>, output, stream, model, responseStreamOptions(options, model));
}

export async function processCodexResponsesStream<TApi extends Api>(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options: OpenAICodexStreamOptions | undefined,
): Promise<void> {
	await processMappedCodexResponsesStream(mapCodexEvents(events), output, stream, model, options);
}
