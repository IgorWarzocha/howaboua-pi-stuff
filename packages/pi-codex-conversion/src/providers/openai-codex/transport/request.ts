import { getDeclaredTools, type Api, type Model, type TranscriptContext, type Transport } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../../../adapter/activation/config.ts";
import { nativeCompactionConfigured } from "../../../adapter/activation/runtime-plan.ts";
import { createGrammarToolInputProperties } from "../../constrained-sampling.ts";
import { readServiceTier } from "../usage.ts";
import { resolveDaybreakAccess } from "../daybreak.ts";
import { buildSSEHeaders, buildWebSocketHeaders, createCodexRequestId, extractAccountId, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexWebSocketUrl } from "../headers.ts";
import { codexDiagnosticsFailure } from "../diagnostic-failure.ts";
import { supportsResponsesLiteModel } from "../responses-lite-model.ts";
import { resolveCodexTranscript } from "../request-body.ts";
import { serializeCodexRequest } from "../request-serialization.ts";
import { applyResponsesLiteWebSocketMetadata } from "../responses-lite.ts";
import { compressRequestBodyZstd, normalizeTimeoutMs } from "../sse.ts";
import { CodexProtocolError } from "../stream-events.ts";
import type { CodexTurnState } from "../turn-state.ts";
import type { BeforeCodexRequestSend, CanonicalHistoryDecision, CodexDiagnosticsLane, CodexDiagnosticsSink, CodexProviderStreamOptions, CodexUsageRecorder, OpenAICodexStreamOptions, ResponsesBody } from "../types.ts";
import { isWebSocketSseFallbackActive, recordWebSocketSseFallback, validateWebSocketTimeoutOptions } from "../websocket.ts";
import { isWebSocketMessageTooBigError, isWebSocketUpgradeRequiredError } from "../websocket-connection.ts";
import { hasRemoteCompactionV2Input, withRemoteCompactionV2Feature } from "../../openai-responses/compaction-v2-feature.ts";
import { captureCanonicalSessionToken, validateCanonicalSessionRequest } from "../session-continuity.ts";
import { preconnectWebSocket } from "../websocket-session-cache.ts";
import { osInfoReady } from "../node-runtime.ts";

export type CodexProviderRuntimeConfig = Pick<CodexConversionConfig, "openai" | "executionMode"> & Partial<Pick<CodexConversionConfig, "compaction">>;

export interface CodexTransportRecoveryDependencies {
	getConfig?: () => CodexProviderRuntimeConfig | undefined;
	useResponsesLite?: (model: Model<Api>) => boolean;
	turnState?: CodexTurnState | undefined;
	onPreparedPayload?: ((payload: ResponsesBody) => void) | undefined;
	beforeRequestSend?: BeforeCodexRequestSend | undefined;
	onStreamSettled?: () => void | undefined;
	getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
	recordUsage?: CodexUsageRecorder | undefined;
	prepareRequestBody: <TApi extends Api>(
		model: Model<TApi>,
		context: TranscriptContext,
		options: OpenAICodexStreamOptions | undefined,
		responsesLite: boolean,
	) => Promise<ResponsesBody>;
}

export function getEffectiveCodexTransport(
	transport: Transport | undefined,
	sessionId?: string | undefined,
): Transport {
	const configuredTransport = transport ?? "auto";
	return configuredTransport !== "sse" && isWebSocketSseFallbackActive(sessionId) ? "sse" : configuredTransport;
}

function diagnosticsLane(body: ResponsesBody): Exclude<CodexDiagnosticsLane, "prewarm"> {
	return body.input.some((item) =>
		item && typeof item === "object" && (item as { type?: unknown }).type === "compaction_trigger"
	) ? "compaction" : "response";
}

export class CodexTransportRequest<TApi extends Api> {
	lane: Exclude<CodexDiagnosticsLane, "prewarm"> = "response";
	readonly runtimeConfig: CodexProviderRuntimeConfig | undefined;
	readonly responsesLite: boolean;
	readonly resolvedContext: TranscriptContext;
	readonly preferredTransport: Transport;
	readonly effectiveTransport: Transport;
	readonly effectiveOptions: OpenAICodexStreamOptions;
	private preconnect: ReturnType<typeof preconnectWebSocket> | undefined;
	private readonly model: Model<TApi>;
	private readonly deps: CodexTransportRecoveryDependencies;
	private readonly options: CodexProviderStreamOptions | undefined;

	constructor(model: Model<TApi>, context: TranscriptContext, options: CodexProviderStreamOptions | undefined, deps: CodexTransportRecoveryDependencies) {
		this.model = model;
		this.deps = deps;
		this.options = options;
		this.runtimeConfig = deps.getConfig?.();
		this.responsesLite = deps.useResponsesLite?.(model)
			?? ((this.runtimeConfig?.executionMode === "code" || this.runtimeConfig?.executionMode === "notebook" || this.runtimeConfig?.executionMode === "ts" || this.runtimeConfig?.executionMode === "js")
				&& supportsResponsesLiteModel(model.id));
		this.resolvedContext = resolveCodexTranscript(model, context);
		const modelSupportsGrammarTools = (model.compat as { supportsOpenAIGrammarTools?: boolean | undefined } | undefined)
			?.supportsOpenAIGrammarTools ?? false;
		const grammarToolInputProperties = createGrammarToolInputProperties(
			getDeclaredTools(context.messages),
			this.responsesLite || modelSupportsGrammarTools,
		);
		this.preferredTransport = getEffectiveCodexTransport(options?.transport);
		this.effectiveTransport = getEffectiveCodexTransport(options?.transport, options?.sessionId);
		this.effectiveOptions = options
			? {
				...options,
				transport: this.effectiveTransport,
				grammarToolInputProperties,
				...(nativeCompactionConfigured(this.runtimeConfig?.compaction) ? { headers: withRemoteCompactionV2Feature(options.headers) } : {}),
			}
			: { transport: this.effectiveTransport, grammarToolInputProperties };
	}
	async close(): Promise<void> { await this.preconnect?.close(); }

	async prepare(diagnostics: CodexDiagnosticsSink | undefined) {
		const { model, deps, options, runtimeConfig, responsesLite, resolvedContext, effectiveTransport, effectiveOptions } = this;
		const apiKey = effectiveOptions?.apiKey;
		if (!apiKey) {
			throw new Error(`No API key for provider: ${model.provider}`);
		}

		const accountId = extractAccountId(apiKey);
		const canonicalSessionToken = captureCanonicalSessionToken(effectiveOptions?.sessionId);
		const websocketRequestId = effectiveOptions?.sessionId || createCodexRequestId();
		const originator = runtimeConfig?.openai.harnessIdentifierHeader === "codex" ? "codex_cli_rs"
			: runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : "pi";
		// Pi has completed every before_agent_start/context hook. Only the
		// handshake overlaps payload rewrites and image preparation, never warmup.
		if (effectiveTransport !== "sse"
			&& deps.beforeRequestSend && effectiveOptions.sessionId
			&& !effectiveOptions.canonicalCompaction && effectiveOptions.cacheRetention !== "none") {
			validateWebSocketTimeoutOptions(effectiveOptions);
			// Do not let async OS discovery change the route's User-Agent mid-preparation.
			await osInfoReady;
			this.preconnect = preconnectWebSocket(
				resolveCodexWebSocketUrl(model.baseUrl),
				buildWebSocketHeaders(model.headers, effectiveOptions.headers, accountId, apiKey, websocketRequestId, originator,
					{ model: model.id, service_tier: effectiveOptions.serviceTier ?? undefined }),
				effectiveOptions.sessionId, accountId, effectiveOptions.signal,
				normalizeTimeoutMs(effectiveOptions.websocketConnectTimeoutMs, "websocketConnectTimeoutMs"), effectiveOptions.env,
				(error) => diagnostics?.({ type: "failure", lane: "prewarm", transport: "websocket", failure: codexDiagnosticsFailure(error) }),
				diagnostics,
			);
		}
		const reconstructedBody = await deps.prepareRequestBody(model, resolvedContext, effectiveOptions, responsesLite);
		const body = reconstructedBody;
		if (hasRemoteCompactionV2Input(body.input)) effectiveOptions.headers = withRemoteCompactionV2Feature(effectiveOptions.headers);
		if (this.preconnect) {
			const finalHeaders = buildWebSocketHeaders(model.headers, effectiveOptions.headers, accountId, apiKey, websocketRequestId, originator, body);
			const failure = await this.preconnect.handoff(resolveCodexWebSocketUrl(model.baseUrl), finalHeaders, accountId, effectiveOptions.env,
				getEffectiveCodexTransport(options?.transport, options?.sessionId) !== "sse");
			if (failure && !(failure.error instanceof CodexProtocolError)
				&& (isWebSocketUpgradeRequiredError(failure.error) || isWebSocketMessageTooBigError(failure.error))) {
				recordWebSocketSseFallback(effectiveOptions.sessionId);
				diagnostics?.({ type: "fallback", lane: diagnosticsLane(body), from: "websocket", to: "sse",
					reason: isWebSocketUpgradeRequiredError(failure.error) ? "upgrade_required" : "message_too_big" });
			}
		}
		if (runtimeConfig) {
			const accessPrograms = await resolveDaybreakAccess(model, effectiveOptions, runtimeConfig.openai.daybreak, body.model, originator);
			delete body.access_programs;
			if (accessPrograms) body.access_programs = accessPrograms;
		}
		await deps.beforeRequestSend?.(model, resolvedContext, body, effectiveOptions, responsesLite);
		// Payload hooks own the final wire tier, including user-selected speed.
		effectiveOptions.serviceTier = readServiceTier(body.service_tier);
		const canonicalHistory: CanonicalHistoryDecision | undefined = effectiveOptions?.canonicalCompaction
			? "compaction"
			: validateCanonicalSessionRequest(
				effectiveOptions?.sessionId,
				resolveCodexWebSocketUrl(model.baseUrl),
				accountId,
				body,
			);
		this.lane = diagnosticsLane(body);
		deps.onPreparedPayload?.(body);
		const baseSseHeaders = buildSSEHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, effectiveOptions?.sessionId, responsesLite, originator, body);
		const websocketHeaders = buildWebSocketHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, websocketRequestId, originator, body);
		const bodyJson = serializeCodexRequest(body);
		const websocketBody = responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body;
		const compressedBody = compressRequestBodyZstd(bodyJson);
		if (compressedBody) baseSseHeaders.set("content-encoding", "zstd");
		const sseBody = compressedBody ?? bodyJson;
		// Final-body preparation may prewarm the main lane and discover a sticky
		// WebSocket incompatibility. Re-read session routing before the real send.
		const transport = getEffectiveCodexTransport(options?.transport, options?.sessionId);
		return { accountId, canonicalSessionToken, reconstructedBody, body, canonicalHistory, baseSseHeaders, websocketHeaders, bodyJson, websocketBody, sseBody, transport };
	}
}
