import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getDeclaredTools,
	normalizeContext,
	type Api,
	type Context,
	type Model,
	type Provider,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { createGrammarToolInputProperties } from "./constrained-sampling.js";
import { extractAccountId, buildWebSocketHeaders, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexWebSocketUrl } from "./openai-codex/headers.ts";
import { noThrowCodexDiagnosticsSink } from "./openai-codex/diagnostic-failure.ts";
import { buildRequestBody, resolveCodexTranscript } from "./openai-codex/request-body.ts";
import { normalizeCodexConfigurationUpdates } from "../adapter/reasoning-updates.ts";
import { openAICodexProviderModels } from "./openai-codex/model-catalog.ts";
import { CODEX_RESERVE_MODEL } from "../codex-usage/reserve-policy.ts";
import { DEFAULT_CODEX_BASE_URL } from "./openai-codex/constants.ts";
import { supportsResponsesLiteModel } from "./openai-codex/responses-lite-model.ts";
import { applyResponsesLiteRequest, applyResponsesLiteWebSocketMetadata, isResponsesLiteRequest, namespaceExistingResponsesLiteRequest, prepareResponsesLiteRequestImages } from "./openai-codex/responses-lite.ts";
import type { BeforeCodexRequestSend, CodexDiagnosticsSink, CodexPrewarmDiagnostics, CodexPrewarmResult, CodexProviderStreamOptions, OpenAICodexStreamOptions, ResponsesBody } from "./openai-codex/types.ts";
import { closeOpenAICodexWebSocketSessions, recordWebSocketSseFallback } from "./openai-codex/websocket.ts";
import { isWebSocketMessageTooBigError, isWebSocketUpgradeRequiredError } from "./openai-codex/websocket-connection.ts";
import { codexCacheKeepaliveSocketSessionId, prewarmWebSocket } from "./openai-codex/websocket-stream.ts";
import { openaiCodexNativeOAuthProvider } from "./openai-codex/oauth.ts";
import { type CodexTurnState, withCodexTurnState } from "./openai-codex/turn-state.ts";
import { withRemoteCompactionV2Feature } from "./openai-responses/compaction-v2-feature.ts";
import { normalizeResponsesToolHistory } from "./openai-responses/tool-history.ts";
import {
	createCodexTransportStream,
	getEffectiveCodexTransport,
	type CodexProviderRuntimeConfig,
} from "./openai-codex/transport-recovery.ts";
import {
	hasContextNamespaceRouters,
	routeContextNamespaceToolStream,
} from "../context-management/namespace-tools.ts";

export { buildRequestBody } from "./openai-codex/request-body.ts";
export { parseSSE } from "./openai-codex/sse.ts";
export { buildCachedWebSocketRequestBody } from "./openai-codex/websocket-continuation.ts";
export { closeOpenAICodexWebSocketSessions };
export type { ResponsesBody } from "./openai-codex/types.ts";

export function closeOpenAICodexKeepaliveWebSocketSession(sessionId: string): void {
	closeOpenAICodexWebSocketSessions(codexCacheKeepaliveSocketSessionId(sessionId));
}

async function prepareCodexRequestBody<TApi extends Api>(
	model: Model<TApi>,
	context: TranscriptContext,
	options: OpenAICodexStreamOptions | undefined,
	responsesLite: boolean,
): Promise<ResponsesBody> {
	let body = buildRequestBody(model, context, options);
	const nextBody = await options?.onPayload?.(body, model);
	if (nextBody !== undefined) body = nextBody as ResponsesBody;
	if (responsesLite) {
		body = isResponsesLiteRequest(body)
			? namespaceExistingResponsesLiteRequest({ ...body, parallel_tool_calls: false })
			: applyResponsesLiteRequest(body);
		body = await prepareResponsesLiteRequestImages(body);
	}
	if (!body.previous_response_id) {
		const input = normalizeResponsesToolHistory(body.input ?? []);
		if (input !== body.input) body = { ...body, input };
	}
	return normalizeCodexConfigurationUpdates(body);
}

export async function prewarmOpenAICodexWebSocket<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: OpenAICodexStreamOptions,
	deps: {
		getConfig?: () => CodexProviderRuntimeConfig | undefined;
		useResponsesLite?: (model: Model<Api>) => boolean;
		turnState?: CodexTurnState | undefined;
		getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
		preserveContinuation?: boolean | undefined;
		retainSocket?: boolean | undefined;
		generate?: boolean | undefined;
		prewarmDiagnostics?: CodexPrewarmDiagnostics | undefined;
	},
): Promise<CodexPrewarmResult | undefined> {
	const runtimeConfig = deps.getConfig?.();
	if (getEffectiveCodexTransport(options.transport, runtimeConfig?.openai, options.sessionId) === "sse") return;
	if (!options.apiKey || !options.sessionId) return;
	const transcript = normalizeContext(context);
	const resolvedContext = resolveCodexTranscript(model, transcript);
	const responsesLite = deps.useResponsesLite?.(model)
		?? ((runtimeConfig?.executionMode === "code" || runtimeConfig?.executionMode === "notebook")
			&& supportsResponsesLiteModel(model.id));
	const modelSupportsGrammarTools = (model.compat as { supportsOpenAIGrammarTools?: boolean | undefined } | undefined)
		?.supportsOpenAIGrammarTools ?? false;
	const grammarToolInputProperties = createGrammarToolInputProperties(
		getDeclaredTools(transcript.messages),
		responsesLite || modelSupportsGrammarTools,
	);
	const effectiveOptions = runtimeConfig?.compaction?.responsesCompaction
		? { ...options, grammarToolInputProperties, headers: withRemoteCompactionV2Feature(options.headers) }
		: { ...options, grammarToolInputProperties };
	const body = await prepareCodexRequestBody(model, resolvedContext, effectiveOptions, responsesLite);
	return prewarmPreparedOpenAICodexWebSocket(model, body, effectiveOptions, responsesLite, deps);
}

export async function prewarmPreparedOpenAICodexWebSocket<TApi extends Api>(
	model: Model<TApi>,
	body: ResponsesBody,
	options: OpenAICodexStreamOptions,
	responsesLite: boolean,
	deps: {
		getConfig?: () => CodexProviderRuntimeConfig | undefined;
		turnState?: CodexTurnState | undefined;
		getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
		preserveContinuation?: boolean | undefined;
		retainSocket?: boolean | undefined;
		generate?: boolean | undefined;
		prewarmDiagnostics?: CodexPrewarmDiagnostics | undefined;
	},
): Promise<CodexPrewarmResult | undefined> {
	const runtimeConfig = deps.getConfig?.();
	if (getEffectiveCodexTransport(options.transport, runtimeConfig?.openai, options.sessionId) === "sse") return;
	if (!options.apiKey || !options.sessionId) return;
	const accountId = extractAccountId(options.apiKey);
	const originator = runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : "pi";
	const headers = buildWebSocketHeaders(model.headers, options.headers, accountId, options.apiKey, options.sessionId, originator);
	const turnState = deps.preserveContinuation ? undefined : deps.turnState;
	const websocketBody = withCodexTurnState(responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body, turnState);
	const diagnostics = noThrowCodexDiagnosticsSink(deps.getDiagnostics?.());
	try {
		return await prewarmWebSocket(
			resolveCodexWebSocketUrl(model.baseUrl),
			websocketBody,
			headers,
			accountId,
			options,
			turnState,
			diagnostics,
			deps.preserveContinuation,
			deps.prewarmDiagnostics,
			deps.generate,
			deps.retainSocket,
		);
	} catch (error) {
		if (!options.signal?.aborted && (isWebSocketUpgradeRequiredError(error) || isWebSocketMessageTooBigError(error))) {
			recordWebSocketSseFallback(options.sessionId);
			return;
		}
		throw error;
	}
}

export function registerOpenAICodexCustomProvider(pi: ExtensionAPI, options: {
	getConfig?: () => CodexProviderRuntimeConfig | undefined;
	useResponsesLite?: (model: Model<Api>) => boolean;
	turnState?: CodexTurnState | undefined;
	onPreparedPayload?: ((payload: ResponsesBody) => void) | undefined;
	beforeRequestSend?: BeforeCodexRequestSend | undefined;
	getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
}): void {
	const streamSimple = (model: Model<Api>, context: TranscriptContext, streamOptions?: CodexProviderStreamOptions) => {
		const stream = createCodexTransportStream(model, context, streamOptions, {
			prepareRequestBody: prepareCodexRequestBody,
			...(options.getConfig ? { getConfig: options.getConfig } : {}),
			...(options.useResponsesLite ? { useResponsesLite: options.useResponsesLite } : {}),
			...(options.turnState ? { turnState: options.turnState } : {}),
			...(options.onPreparedPayload ? { onPreparedPayload: options.onPreparedPayload } : {}),
			...(options.beforeRequestSend ? { beforeRequestSend: options.beforeRequestSend } : {}),
			...(options.getDiagnostics ? { getDiagnostics: options.getDiagnostics } : {}),
		});
		return hasContextNamespaceRouters(context)
			? routeContextNamespaceToolStream(stream)
			: stream;
	};
	const models = openAICodexProviderModels();
	// Native registration puts the catalog below models.json, not above it.
	const provider: Provider<"openai-codex-responses"> = {
		id: "openai-codex",
		name: "OpenAI Codex",
		baseUrl: DEFAULT_CODEX_BASE_URL,
		auth: { oauth: openaiCodexNativeOAuthProvider },
		getModels: () => models,
		filterModels: (available) => available.filter(({ id }) => id !== CODEX_RESERVE_MODEL),
		stream: streamSimple,
		streamSimple,
	};
	pi.registerProvider(provider);
}
