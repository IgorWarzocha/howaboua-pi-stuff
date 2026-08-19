import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { createGrammarToolInputProperties } from "./constrained-sampling.js";
import { extractAccountId, buildWebSocketHeaders, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexRequestRouting, resolveCodexWebSocketUrl } from "./openai-codex/headers.ts";
import { noThrowCodexDiagnosticsSink } from "./openai-codex/diagnostic-failure.ts";
import { DEFAULT_CODEX_BASE_URL } from "./openai-codex/constants.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { openAICodexModelsWithDaybreak } from "./openai-codex/model-catalog.ts";
import { supportsResponsesLiteModel } from "./openai-codex/responses-lite-model.ts";
import { applyResponsesLiteRequest, applyResponsesLiteWebSocketMetadata, isResponsesLiteRequest, namespaceExistingResponsesLiteRequest, prepareResponsesLiteRequestImages } from "./openai-codex/responses-lite.ts";
import type { CodexDiagnosticsSink, CodexPrewarmResult, OpenAICodexStreamOptions, ResponsesBody } from "./openai-codex/types.ts";
import { recordWebSocketSseFallback } from "./openai-codex/websocket.ts";
import { isWebSocketMessageTooBigError, isWebSocketUpgradeRequiredError } from "./openai-codex/websocket-connection.ts";
import { prewarmWebSocket } from "./openai-codex/websocket-stream.ts";
import { openaiCodexNativeOAuthProvider } from "./openai-codex/oauth.ts";
import { type CodexTurnState, withCodexTurnState } from "./openai-codex/turn-state.ts";
import { withRemoteCompactionV2Feature } from "./openai-responses/compaction-v2-feature.ts";
import { normalizeResponsesToolHistory } from "./openai-responses/tool-history.ts";
import {
	createCodexTransportStream,
	getEffectiveCodexTransport,
	type CodexProviderRuntimeConfig,
} from "./openai-codex/transport-recovery.ts";

export { buildRequestBody } from "./openai-codex/request-body.ts";
export { parseSSE } from "./openai-codex/sse.ts";
export { buildCachedWebSocketRequestBody } from "./openai-codex/websocket-continuation.ts";
export { closeOpenAICodexWebSocketSessions } from "./openai-codex/websocket.ts";
export type { ResponsesBody } from "./openai-codex/types.ts";

async function prepareCodexRequestBody<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
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
	return body;
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
		preparedBody?: ResponsesBody | undefined;
		preserveContinuation?: boolean | undefined;
	},
): Promise<CodexPrewarmResult | undefined> {
	const runtimeConfig = deps.getConfig?.();
	if (getEffectiveCodexTransport(options.transport, runtimeConfig?.openai, options.sessionId) === "sse") return;
	if (!options.apiKey || !options.sessionId) return;
	const responsesLite = deps.useResponsesLite?.(model)
		?? ((runtimeConfig?.executionMode === "code" || runtimeConfig?.executionMode === "notebook")
			&& supportsResponsesLiteModel(model.id));
	const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, responsesLite);
	const effectiveOptions = runtimeConfig?.compaction?.responsesCompaction
		? { ...options, grammarToolInputProperties, headers: withRemoteCompactionV2Feature(options.headers) }
		: { ...options, grammarToolInputProperties };
	const body = deps.preparedBody ? structuredClone(deps.preparedBody) : await prepareCodexRequestBody(model, context, effectiveOptions, responsesLite);
	const accountId = extractAccountId(options.apiKey);
	const routing = resolveCodexRequestRouting({
		model: body.model,
		fast: runtimeConfig?.openai.fast === true,
		serviceTier: body.service_tier,
		normalOriginator: runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : "pi",
	});
	const headers = buildWebSocketHeaders(model.headers, effectiveOptions.headers, accountId, options.apiKey, options.sessionId, routing.originator, routing.routingHint);
	const turnState = deps.preserveContinuation ? undefined : deps.turnState;
	const websocketBody = withCodexTurnState(responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body, turnState);
	const diagnostics = noThrowCodexDiagnosticsSink(deps.getDiagnostics?.());
	try {
		return await prewarmWebSocket(resolveCodexWebSocketUrl(model.baseUrl), websocketBody, headers, accountId, effectiveOptions, turnState, diagnostics, deps.preserveContinuation);
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
	getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
}): void {
	pi.registerProvider("openai-codex", {
		api: "openai-codex-responses",
		baseUrl: DEFAULT_CODEX_BASE_URL,
		models: openAICodexModelsWithDaybreak(),
		oauth: openaiCodexNativeOAuthProvider,
		streamSimple: (model, context, streamOptions) => createCodexTransportStream(model, context, streamOptions, {
			prepareRequestBody: prepareCodexRequestBody,
			...(options.getConfig ? { getConfig: options.getConfig } : {}),
			...(options.useResponsesLite ? { useResponsesLite: options.useResponsesLite } : {}),
			...(options.turnState ? { turnState: options.turnState } : {}),
			...(options.onPreparedPayload ? { onPreparedPayload: options.onPreparedPayload } : {}),
			...(options.getDiagnostics ? { getDiagnostics: options.getDiagnostics } : {}),
		}),
	});
}
