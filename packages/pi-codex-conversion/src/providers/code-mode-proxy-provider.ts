import OpenAI, { APIError } from "openai";
import {
	createAssistantMessageEventStream,
	lazyApi,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type ProviderHeaders,
	type ProviderStreams,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { shouldUseGpt56CodeMode } from "../adapter/activation/activation.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { isResponsesLiteRequest, prepareResponsesLiteRequestImages, RESPONSES_LITE_HEADER } from "./openai-codex/responses-lite.ts";
import { processCodexResponsesStream } from "./openai-codex/stream-events.ts";
import type { OpenAICodexStreamOptions, ResponsesBody, StreamEventShape } from "./openai-codex/types.ts";

const LEGACY_BRIDGE_PROVIDER = "@howaboua/pi-codex-conversion:responses-proxy";
const OPENAI_RESPONSES_API_MODULE = "@earendil-works/pi-ai/api/openai-responses";
const standardResponsesStream = lazyApi(async () =>
	await import(OPENAI_RESPONSES_API_MODULE) as ProviderStreams
).streamSimple;

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

function clientAuth(provider: string, apiKey: string | undefined, headers: ProviderHeaders): { apiKey: string; headers: ProviderHeaders } {
	if (apiKey) return { apiKey, headers };
	if (hasHeader(headers, "authorization")) return { apiKey: "unused", headers };
	if (hasHeader(headers, "cf-aig-authorization")) {
		return { apiKey: "unused", headers: mergeHeaders(headers, { Authorization: null }) };
	}
	throw new Error(`No API key for provider: ${provider}`);
}

async function reportErrorResponse<TApi extends Api>(error: unknown, options: SimpleStreamOptions | undefined, model: Model<TApi>): Promise<void> {
	if (!(error instanceof APIError) || error.status === undefined || !error.headers) return;
	await options?.onResponse?.({
		status: error.status,
		headers: Object.fromEntries(error.headers.entries()),
	}, model);
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
			headers = mergeHeaders(headers, { [RESPONSES_LITE_HEADER]: null });
			if (isResponsesLiteRequest(body)) {
				body = await prepareResponsesLiteRequestImages(body);
				headers = mergeHeaders(headers, { [RESPONSES_LITE_HEADER]: "true" });
			}

			const auth = clientAuth(model.provider, options?.apiKey, headers);
			const client = new OpenAI({
				apiKey: auth.apiKey,
				baseURL: model.baseUrl,
				defaultHeaders: auth.headers,
			});
			let response;
			try {
				response = await client.responses.create(
					body as unknown as ResponseCreateParamsStreaming,
					{
						...(options?.signal ? { signal: options.signal } : {}),
						...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
						maxRetries: options?.maxRetries ?? 0,
					},
				).withResponse();
			} catch (error) {
				await reportErrorResponse(error, options, model);
				throw error;
			}
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
	applyConfig(config: CodexConversionConfig, modelRegistry: CodeModeModelRegistry): void;
	shutdown(): void;
}

type CodeModeModelRegistry = Pick<ModelRegistry, "getAll"> & Partial<Pick<ModelRegistry, "getRegisteredProviderConfig">>;
type RegisteredProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];

function configuredProxyProviders(config: CodexConversionConfig): Set<string> {
	return new Set(config.beta.codeMode
		? config.scope.additionalProviders.filter((provider) => provider !== "openai-codex")
		: []);
}

function resolveProviderIds(configuredProviders: Set<string>, modelRegistry: CodeModeModelRegistry): Set<string> {
	const resolved = new Set<string>();
	for (const model of modelRegistry.getAll()) {
		if (model.api === "openai-responses" && configuredProviders.has(model.provider.trim().toLowerCase())) resolved.add(model.provider);
	}
	return resolved;
}

export function registerCodeModeProxyProvider(
	pi: ExtensionAPI,
	getConfig: () => CodexConversionConfig,
): CodeModeProxyProviderRegistration {
	const registeredProviders = new Map<string, {
		previous: RegisteredProviderConfig | undefined;
		overlayStream: NonNullable<RegisteredProviderConfig["streamSimple"]>;
		modelRegistry: CodeModeModelRegistry;
	}>();
	let legacyBridgeRegistered = false;
	const restoreProvider = (provider: string, registration: NonNullable<ReturnType<typeof registeredProviders.get>>) => {
		const current = registration.modelRegistry.getRegisteredProviderConfig?.(provider) as RegisteredProviderConfig | undefined;
		if (!current || current.streamSimple !== registration.overlayStream) return;
		const restored = { ...current } as RegisteredProviderConfig;
		if (registration.previous?.streamSimple) restored.streamSimple = registration.previous.streamSimple;
		else delete restored.streamSimple;
		if (registration.previous?.api) restored.api = registration.previous.api;
		else if (!registration.previous?.streamSimple && current.api === "openai-responses") delete restored.api;
		pi.unregisterProvider(provider);
		if (Object.keys(restored).length > 0) pi.registerProvider(provider, restored);
	};
	const shutdown = () => {
		if (legacyBridgeRegistered) {
			pi.unregisterProvider(LEGACY_BRIDGE_PROVIDER);
			legacyBridgeRegistered = false;
		}
		for (const [provider, registration] of registeredProviders) restoreProvider(provider, registration);
		registeredProviders.clear();
	};
	const applyConfig = (config: CodexConversionConfig, modelRegistry: CodeModeModelRegistry) => {
		const configuredProviders = configuredProxyProviders(config);
		if (!modelRegistry.getRegisteredProviderConfig) {
			const needed = configuredProviders.size > 0;
			if (needed === legacyBridgeRegistered) return;
			if (!needed) {
				pi.unregisterProvider(LEGACY_BRIDGE_PROVIDER);
				legacyBridgeRegistered = false;
				return;
			}
			pi.registerProvider(LEGACY_BRIDGE_PROVIDER, {
				api: "openai-responses",
				streamSimple: (model, context, options) =>
					shouldUseGpt56CodeMode({ model }, getConfig())
						? streamCodeModeResponsesProxy(model, context, options)
						: standardResponsesStream(model as never, context, options),
			});
			legacyBridgeRegistered = true;
			return;
		}
		const desiredProviders = resolveProviderIds(configuredProviders, modelRegistry);
		for (const provider of desiredProviders) {
			if (registeredProviders.has(provider)) continue;
			const previous = modelRegistry.getRegisteredProviderConfig(provider) as RegisteredProviderConfig | undefined;
			if (previous?.streamSimple && previous.api !== "openai-responses") continue;
			const fallbackStream = previous?.api === "openai-responses" && previous.streamSimple
				? previous.streamSimple
				: standardResponsesStream;
			const overlayStream: NonNullable<RegisteredProviderConfig["streamSimple"]> = (model, context, options) =>
				shouldUseGpt56CodeMode({ model }, getConfig())
					? streamCodeModeResponsesProxy(model, context, options)
					: fallbackStream(model as never, context, options);
			pi.registerProvider(provider, {
				api: "openai-responses",
				streamSimple: overlayStream,
			});
			registeredProviders.set(provider, { previous, overlayStream, modelRegistry });
		}
		for (const [provider, registration] of registeredProviders) {
			if (desiredProviders.has(provider)) continue;
			restoreProvider(provider, registration);
			registeredProviders.delete(provider);
		}
	};

	return { applyConfig, shutdown };
}
