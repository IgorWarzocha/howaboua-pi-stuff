import { type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions, type Transport } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { NativeCompactionRuntime } from "./compaction-runtime.ts";
import type { NativeCompactionRequestOptions, ResponsesInputItem } from "./serializer.ts";
import { shrinkNativeCompactionRequestForEndpoint } from "./request-shrink.ts";
import { canonicalCompactionOutput, normalizeRemoteCompactionV2PromptInput } from "./remote-v2-history.ts";
import { withRemoteCompactionV2Feature } from "../../providers/openai-responses/compaction-v2-feature.ts";
import type { OpenAICodexStreamOptions, ResponsesBody } from "../../providers/openai-codex/types.ts";
import { sleep } from "../../providers/openai-codex/sse.ts";
import { streamCodeModeResponsesProxy } from "../../providers/code-mode-proxy-provider.ts";

const MAX_STREAM_RETRIES = 2;
type V2Stream = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AsyncIterable<unknown>;

export type RemoteCompactionV2Result =
	| { ok: true; compaction: Record<string, unknown>; responseId: string; createdAt: string }
	| { ok: false; reason: "aborted" | "unavailable" | "stream-error" | "invalid-output"; errorMessage: string; status?: number | undefined };

export type ExecuteRemoteCompactionV2Options = {
	runtime: NativeCompactionRuntime;
	modelRegistry: ModelRegistry;
	context: Context;
	promptInput: readonly ResponsesInputItem[];
	requestOptions: NativeCompactionRequestOptions;
	sessionId: string;
	signal?: AbortSignal | undefined;
	transport?: Transport | undefined;
	retryDelayMs?: number | undefined;
};

function resolveStream(options: ExecuteRemoteCompactionV2Options): V2Stream | undefined {
	const registration = options.modelRegistry.getRegisteredProviderConfig(options.runtime.provider);
	if (options.runtime.provider === "openai-codex") {
		return registration?.api === "openai-codex-responses" && registration.streamSimple
			? registration.streamSimple as V2Stream
			: undefined;
	}
	if (options.runtime.api !== "openai-responses") return undefined;
	return streamCodeModeResponsesProxy as V2Stream;
}

function isAborted(signal: AbortSignal | undefined, message: string): boolean {
	return signal?.aborted === true || /request was aborted|\baborted\b/i.test(message);
}

function shouldRetry(result: Extract<RemoteCompactionV2Result, { ok: false }>): boolean {
	if (result.status === 429) return false;
	return !/\b(?:401|403)\b|unauthori[sz]ed|forbidden|usage limit|quota|not included|invalid request|context window|unsupported parameter/i.test(result.errorMessage);
}

async function runAttempt(options: ExecuteRemoteCompactionV2Options, streamSimple: V2Stream): Promise<RemoteCompactionV2Result> {
	const outputItems: unknown[] = [];
	let responseStatus: number | undefined;
	const streamOptions: OpenAICodexStreamOptions = {
		...(options.runtime.apiKey ? { apiKey: options.runtime.apiKey } : {}),
		headers: withRemoteCompactionV2Feature(options.runtime.headers),
		sessionId: options.sessionId,
		...(options.signal ? { signal: options.signal } : {}),
		...(options.transport ? { transport: options.transport } : {}),
		maxRetries: 0,
		...(typeof options.requestOptions.service_tier === "string" ? { serviceTier: options.requestOptions.service_tier as never } : {}),
		...(options.requestOptions.text?.verbosity ? { textVerbosity: options.requestOptions.text.verbosity } : {}),
		onOutputItemDone: (item) => outputItems.push(item),
		onResponse: (response) => { responseStatus = response.status; },
		onPayload: async (payload) => {
			const body = payload as ResponsesBody;
			const promptInput = normalizeRemoteCompactionV2PromptInput(options.promptInput) as ResponsesInputItem[];
			const request = await shrinkNativeCompactionRequestForEndpoint({
				model: body.model,
				input: promptInput,
				...(typeof body.instructions === "string" ? { instructions: body.instructions } : {}),
			}, { contextWindow: options.runtime.currentModel.contextWindow });
			return {
				...body,
				input: [...request.request.input, { type: "compaction_trigger" }],
				...(options.requestOptions.reasoning ? { reasoning: structuredClone(options.requestOptions.reasoning) } : {}),
			};
		},
	};

	let completed: AssistantMessage | undefined;
	let completedNormally = false;
	for await (const rawEvent of streamSimple(options.runtime.currentModel, options.context, streamOptions)) {
		const event = rawEvent as { type?: string; reason?: string; message?: AssistantMessage; error?: AssistantMessage };
		if (event.type === "done") {
			completed = event.message;
			completedNormally = event.reason === "stop" && event.message?.stopReason === "stop";
		}
		if (event.type === "error") {
			const message = event.error?.errorMessage || "Responses compaction v2 stream failed";
			return {
				ok: false,
				reason: isAborted(options.signal, message) ? "aborted" : "stream-error",
				errorMessage: message,
				...(responseStatus !== undefined ? { status: responseStatus } : {}),
			};
		}
	}
	if (!completed?.responseId || !completedNormally) {
		return { ok: false, reason: "stream-error", errorMessage: "Responses compaction v2 stream did not complete normally" };
	}
	const compactions = outputItems.map(canonicalCompactionOutput).filter((item) => item !== undefined);
	if (compactions.length !== 1) {
		return { ok: false, reason: "invalid-output", errorMessage: `Responses compaction v2 expected exactly one compaction output item, got ${compactions.length} from ${outputItems.length} output items` };
	}
	return { ok: true, compaction: compactions[0]!, responseId: completed.responseId, createdAt: new Date().toISOString() };
}

export async function executeRemoteCompactionV2(options: ExecuteRemoteCompactionV2Options): Promise<RemoteCompactionV2Result> {
	const streamSimple = resolveStream(options);
	if (!streamSimple) return { ok: false, reason: "unavailable", errorMessage: "No compatible Responses stream is registered for this provider" };
	const initialTransport = options.transport ?? (options.runtime.provider === "openai-codex" ? "websocket-cached" : "sse");
	const transports: Transport[] = options.runtime.provider === "openai-codex" && initialTransport !== "sse"
		? [initialTransport, "sse"]
		: [initialTransport];
	const delayMs = Math.max(0, options.retryDelayMs ?? 500);
	let lastFailure: Extract<RemoteCompactionV2Result, { ok: false }> | undefined;
	for (const transport of transports) {
		for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
			const result = await runAttempt({ ...options, transport }, streamSimple);
			if (result.ok) return result;
			if (result.reason === "aborted" || result.reason === "unavailable" || result.reason === "invalid-output" || !shouldRetry(result)) return result;
			lastFailure = result;
			if (attempt < MAX_STREAM_RETRIES) {
				try { await sleep(delayMs * 2 ** attempt, options.signal); }
				catch { return { ok: false, reason: "aborted", errorMessage: "Request was aborted" }; }
			}
		}
	}
	return lastFailure ?? { ok: false, reason: "stream-error", errorMessage: "Responses compaction v2 failed without a transport attempt" };
}
