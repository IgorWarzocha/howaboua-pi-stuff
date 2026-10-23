import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerSessionResourceCleanup,
	type Api,
	type Model,
	type Provider,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { extractAccountId, buildWebSocketHeaders, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexWebSocketUrl } from "./openai-codex/headers.ts";
import { noThrowCodexDiagnosticsSink } from "./openai-codex/diagnostic-failure.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { normalizeCodexConfigurationUpdates } from "../adapter/reasoning-updates.ts";
import { openAICodexProviderModels } from "./openai-codex/model-catalog.ts";
import { CODEX_RESERVE_MODEL } from "../codex-usage/reserve-policy.ts";
import { DEFAULT_CODEX_BASE_URL } from "./openai-codex/constants.ts";
import { applyResponsesLiteRequest, applyResponsesLiteWebSocketMetadata, isResponsesLiteRequest, namespaceExistingResponsesLiteRequest, prepareResponsesLiteRequestImages } from "./openai-codex/responses-lite.ts";
import type { BeforeCodexRequestSend, CodexDiagnosticsSink, CodexPrewarmDiagnostics, CodexPrewarmResult, CodexProviderStreamOptions, CodexUsageRecorder, OpenAICodexStreamOptions, ResponsesBody } from "./openai-codex/types.ts";
import { closeOpenAICodexWebSocketSessions, recordWebSocketSseFallback } from "./openai-codex/websocket.ts";
import { isWebSocketMessageTooBigError, isWebSocketUpgradeRequiredError } from "./openai-codex/websocket-connection.ts";
import { codexCacheKeepaliveSocketSessionId, prewarmWebSocket } from "./openai-codex/websocket-stream.ts";
import { openaiCodexNativeOAuthProvider } from "./openai-codex/oauth.ts";
import { CodexProtocolError } from "./openai-codex/stream-events.ts";
import { type CodexTurnState, withCodexTurnState } from "./openai-codex/turn-state.ts";
import { hasRemoteCompactionV2Input, withRemoteCompactionV2Feature } from "./openai-responses/compaction-v2-feature.ts";
import { normalizeResponsesToolHistory } from "./openai-responses/tool-history.ts";
import { assertRemoteDeliveryPairs } from "../tools/code-mode/protected-delivery-protocol.ts";
import {
	createCodexTransportStream,
	getEffectiveCodexTransport,
	type CodexProviderRuntimeConfig,
} from "./openai-codex/transport-recovery.ts";

export { closeOpenAICodexWebSocketSessions };
export type { ResponsesBody } from "./openai-codex/types.ts";

export function closeOpenAICodexKeepaliveWebSocketSession(sessionId: string): void {
	closeOpenAICodexWebSocketSessions(codexCacheKeepaliveSocketSessionId(sessionId));
}

// Like Pi's stock provider, cleanup lives with the shared module pool, not an
// individual extension registration that may shut down while others still use it.
registerSessionResourceCleanup(sessionId => {
	closeOpenAICodexWebSocketSessions(sessionId);
	if (sessionId) closeOpenAICodexKeepaliveWebSocketSession(sessionId);
});

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
		generate?: boolean | undefined;
		prewarmDiagnostics?: CodexPrewarmDiagnostics | undefined;
		validateRequest?: ((body: ResponsesBody, responsesLite: boolean) => Promise<void>) | undefined;
	},
): Promise<CodexPrewarmResult | undefined> {
	const runtimeConfig = deps.getConfig?.();
	const transport = getEffectiveCodexTransport(options.transport, options.sessionId);
	if (transport === "sse" || (transport === "websocket" && !deps.preserveContinuation)) return;
	if (!options.apiKey || !options.sessionId) return;
	if (assertRemoteDeliveryPairs(body.input) > 0 && !deps.validateRequest)
		throw new Error("Remote delivery requires its session validation before prewarm");
	await deps.validateRequest?.(body, responsesLite);
	const accountId = extractAccountId(options.apiKey);
	const originator = runtimeConfig?.openai.harnessIdentifierHeader === "codex" ? "codex_cli_rs"
		: runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : "pi";
	const requestHeaders = hasRemoteCompactionV2Input(body.input) ? withRemoteCompactionV2Feature(options.headers) : options.headers;
	const headers = buildWebSocketHeaders(model.headers, requestHeaders, accountId, options.apiKey, options.sessionId, originator, body);
	const turnState = deps.preserveContinuation ? undefined : deps.turnState;
	const websocketBody = withCodexTurnState(responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body, turnState);
	const sink = noThrowCodexDiagnosticsSink(deps.getDiagnostics?.());
	let localRequestId: string | undefined;
	const diagnostics: CodexDiagnosticsSink | undefined = sink ? event => {
		localRequestId = event.requestId;
		sink(event);
	} : undefined;
	try {
		return await prewarmWebSocket(
			model,
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
		);
	} catch (error) {
		if (!options.signal?.aborted && !(error instanceof CodexProtocolError) && (isWebSocketUpgradeRequiredError(error) || isWebSocketMessageTooBigError(error))) {
			recordWebSocketSseFallback(options.sessionId);
			diagnostics?.({ type: "fallback", lane: "prewarm", requestId: localRequestId,
				from: "websocket", to: "sse", reason: isWebSocketUpgradeRequiredError(error) ? "upgrade_required" : "message_too_big" });
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
	getDiagnostics?: ((sessionId: string | undefined) => CodexDiagnosticsSink | undefined) | undefined;
	recordUsage?: CodexUsageRecorder | undefined;
}): void {
	const streamSimple = (model: Model<Api>, context: TranscriptContext, streamOptions?: CodexProviderStreamOptions) => {
		const diagnostics = options.getDiagnostics?.(streamOptions?.sessionId);
		const stream = createCodexTransportStream(model, context, streamOptions, {
			prepareRequestBody: prepareCodexRequestBody,
			...(options.getConfig ? { getConfig: options.getConfig } : {}),
			...(options.useResponsesLite ? { useResponsesLite: options.useResponsesLite } : {}),
			...(options.turnState ? { turnState: options.turnState } : {}),
			...(options.onPreparedPayload ? { onPreparedPayload: options.onPreparedPayload } : {}),
			...(options.beforeRequestSend ? { beforeRequestSend: options.beforeRequestSend } : {}),
			...(diagnostics ? { getDiagnostics: () => diagnostics } : {}),
			...(options.recordUsage ? { recordUsage: options.recordUsage } : {}),
		});
		return stream;
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
