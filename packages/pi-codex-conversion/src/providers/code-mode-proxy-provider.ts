import OpenAI from "openai";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type ProviderHeaders,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { streamSimple as standardResponsesStream } from "@earendil-works/pi-ai/api/openai-responses";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { shouldUseGpt56CodeMode } from "../adapter/activation/activation.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { isResponsesLiteRequest, prepareResponsesLiteRequestImages, RESPONSES_LITE_HEADER } from "./openai-codex/responses-lite.ts";
import { processCodexResponsesStream } from "./openai-codex/stream-events.ts";
import type { OpenAICodexStreamOptions, ResponsesBody, StreamEventShape } from "./openai-codex/types.ts";

const BRIDGE_PROVIDER = "@howaboua/pi-codex-conversion:responses-proxy";

function initialAssistantMessage<TApi extends Api>(model: Model<TApi>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function mergeHeaders(...groups: Array<ProviderHeaders | undefined>): ProviderHeaders {
	const headers = new Map<string, { name: string; value: string | null }>();
	for (const group of groups) {
		for (const [name, value] of Object.entries(group ?? {})) {
			headers.set(name.toLowerCase(), { name, value });
		}
	}
	return Object.fromEntries([...headers.values()].map(({ name, value }) => [name, value]));
}

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
	const expected = name.toLowerCase();
	return Object.entries(headers ?? {}).some(
		([key, value]) => key.toLowerCase() === expected && value !== null && value.trim() !== "",
	);
}

function clientApiKey(provider: string, apiKey: string | undefined, headers: ProviderHeaders): string {
	if (apiKey) return apiKey;
	if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization")) return "unused";
	throw new Error(`No API key for provider: ${provider}`);
}

export function streamCodeModeResponsesProxy<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
) {
	const stream = createAssistantMessageEventStream();
	const output = initialAssistantMessage(model);

	void (async () => {
		try {
			let headers = mergeHeaders(model.headers, options?.headers);
			let body: ResponsesBody = buildRequestBody(model, context, options);
			const rewritten = await options?.onPayload?.(body, model);
			if (rewritten !== undefined) body = rewritten as ResponsesBody;
			if (isResponsesLiteRequest(body)) {
				body = await prepareResponsesLiteRequestImages(body);
				headers = mergeHeaders(headers, { [RESPONSES_LITE_HEADER]: "true" });
			}

			const client = new OpenAI({
				apiKey: clientApiKey(model.provider, options?.apiKey, headers),
				baseURL: model.baseUrl,
				defaultHeaders: headers,
			});
			const response = await client.responses.create(
				body as unknown as ResponseCreateParamsStreaming,
				{
					...(options?.signal ? { signal: options.signal } : {}),
					...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
					maxRetries: options?.maxRetries ?? 0,
				},
			).withResponse();
			await options?.onResponse?.({
				status: response.response.status,
				headers: Object.fromEntries(response.response.headers.entries()),
			}, model);

			stream.push({ type: "start", partial: output });
			await processCodexResponsesStream(
				response.data as unknown as AsyncIterable<StreamEventShape>,
				output,
				stream,
				model,
				options as OpenAICodexStreamOptions | undefined,
			);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("Responses stream ended without a successful result");
			}
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				if (typeof block === "object" && block !== null) delete (block as { partialJson?: unknown }).partialJson;
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

export interface CodeModeProxyProviderRegistration {
	applyConfig(config: CodexConversionConfig): void;
	shutdown(): void;
}

export function registerCodeModeProxyProvider(
	pi: ExtensionAPI,
	getConfig: () => CodexConversionConfig,
): CodeModeProxyProviderRegistration {
	let registered = false;
	let fallbackStream = standardResponsesStream;
	const shutdown = () => {
		if (!registered) return;
		pi.unregisterProvider(BRIDGE_PROVIDER);
		registered = false;
	};
	const applyConfig = (config: CodexConversionConfig) => {
		const needed = config.beta.codeMode && config.scope.additionalProviders.some((provider) => {
			const normalized = provider.trim().toLowerCase();
			return normalized !== "" && normalized !== "openai-codex";
		});
		if (needed === registered) return;
		if (!needed) {
			shutdown();
			return;
		}
		fallbackStream = getApiProvider("openai-responses")?.streamSimple ?? standardResponsesStream;
		pi.registerProvider(BRIDGE_PROVIDER, {
			api: "openai-responses",
			streamSimple: (model, context, options) =>
				shouldUseGpt56CodeMode({ model }, getConfig())
					? streamCodeModeResponsesProxy(model, context, options)
					: fallbackStream(model as never, context, options),
		});
		registered = true;
	};

	return { applyConfig, shutdown };
}
