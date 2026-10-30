import { createCodexRequestTiming, type CodexAttemptTiming } from "./diagnostic-timing.ts";
import { codexRequestDiagnostics } from "./diagnostic-request.ts";
import { appendAssistantMessageDiagnostic, createAssistantMessageDiagnostic, createAssistantMessageEventStream, type Api, type AssistantMessage, type AssistantMessageEventStream, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS, MAX_WEBSOCKET_RECOVERY_RETRIES } from "./constants.ts";
import { createErrorMessage, NonRetryableProviderError } from "./errors.ts";
import { resolveCodexWebSocketUrl } from "./headers.ts";
import { codexDiagnosticsFailure, noThrowCodexDiagnosticsSink } from "./diagnostic-failure.ts";
import { normalizeTimeoutMs, parseSSE } from "./sse.ts";
import { assertSuccessfulCodexOutput, CodexProtocolError, isCodexApiError, isRetryableCodexStreamError, processCodexResponsesStream } from "./stream-events.ts";
import { withCodexTurnState } from "./turn-state.ts";
import type { CodexDiagnosticsLane, CodexDiagnosticsSink, CodexProviderStreamOptions } from "./types.ts";
import { createInitialAssistantMessage } from "./types.ts";
import { finalizeUsage } from "./usage.ts";
import { recordWebSocketSseFallback, validateWebSocketTimeoutOptions } from "./websocket.ts";
import { isPermanentWebSocketError, isWebSocketConnectionError, isWebSocketMessageTooBigError, isWebSocketUnauthorizedError, isWebSocketUpgradeRequiredError } from "./websocket-connection.ts";
import { processWebSocketStream } from "./websocket-stream.ts";
import { recordCanonicalSessionResponse } from "./session-continuity.ts";
import { CodexRecoveryBudget, codexStreamMaxRetries, retryAdviceRecoveryBudgetError } from "./transport/recovery-budget.ts";
import { CodexTransportRequest, type CodexTransportRecoveryDependencies } from "./transport/request.ts";
import { openCodexSSE } from "./transport/sse-request.ts";

function recordUsage(
	record: CodexDiagnosticsSink | undefined,
	lane: Exclude<CodexDiagnosticsLane, "prewarm">,
	transport: "websocket" | "sse",
	output: AssistantMessage,
): void {
	record?.({
		type: "usage",
		lane,
		transport,
		inputTokens: output.usage.input,
		cachedInputTokens: output.usage.cacheRead,
		cacheWriteInputTokens: output.usage.cacheWrite,
		outputTokens: output.usage.output,
	});
}

export function createCodexTransportStream<TApi extends Api>(
	model: Model<TApi>,
	context: TranscriptContext,
	options: CodexProviderStreamOptions | undefined,
	deps: CodexTransportRecoveryDependencies,
): AssistantMessageEventStream {
	const request = new CodexTransportRequest(model, context, options, deps);
	const { preferredTransport, effectiveTransport, effectiveOptions } = request;
	const stream = createAssistantMessageEventStream();

	(async () => {
		let output = createInitialAssistantMessage(model);
		const sink = noThrowCodexDiagnosticsSink(deps.getDiagnostics?.());
		const requestTiming = createCodexRequestTiming(sink, undefined, effectiveOptions?.sessionId);
		const diagnostics: CodexDiagnosticsSink | undefined = sink ? event => sink({ ...event, requestId: requestTiming.requestId,
			sessionRequestOrdinal: requestTiming.sessionRequestOrdinal, requestCounterProcessId: requestTiming.requestCounterProcessId }) : undefined;
		let diagnosticsFailureRecorded = false;
		let recoveryForCleanup: CodexRecoveryBudget | undefined;
		const recordFailure = (transport: "websocket" | "sse", error: unknown) => {
			if (!diagnostics) return;
			diagnosticsFailureRecorded = true;
			diagnostics({ type: "failure", lane: request.lane, transport, failure: codexDiagnosticsFailure(error) });
		};
		try {
			const { accountId, canonicalSessionToken, reconstructedBody, body, canonicalHistory, baseSseHeaders, websocketHeaders, bodyJson, websocketBody, sseBody, transport } = await request.prepare(diagnostics);
			const lane = request.lane;
			const streamMaxRetries = codexStreamMaxRetries(effectiveOptions);
			const callerSignal = effectiveOptions.signal;
			const recovery = new CodexRecoveryBudget(callerSignal);
			recoveryForCleanup = recovery;
			let websocketRecoveryRetries = 0;
			let streamStarted = false;
			if (transport !== "sse") {
				validateWebSocketTimeoutOptions(effectiveOptions);
				for (let attempt = 0; attempt <= streamMaxRetries; attempt++) {
					if (attempt > 0) output = createInitialAssistantMessage(model);
					if (recovery.recoveryDeadlineAt !== undefined) websocketRecoveryRetries++;
					const attemptSignal = recovery.signal();
					const attemptOptions = attemptSignal ? { ...effectiveOptions, signal: attemptSignal.signal } : effectiveOptions;
					let websocketStarted = false;
					const timing = requestTiming.start(lane, "websocket");
					try {
						await processWebSocketStream(
							resolveCodexWebSocketUrl(model.baseUrl),
							withCodexTurnState(websocketBody, deps.turnState),
							websocketHeaders,
							output,
							stream,
							model,
							accountId,
							() => {
								websocketStarted = true;
								if (!streamStarted) {
									streamStarted = true;
									stream.push({ type: "start", partial: output });
								}
							},
							attemptOptions,
							deps.turnState,
							diagnostics ? { lane, attempt: timing.attempt, record: diagnostics, requestId: requestTiming.requestId, timing } : undefined,
							{
								reconstructedRequestBody: reconstructedBody,
								token: canonicalSessionToken,
								decision: canonicalHistory,
							},
						);
						if (callerSignal?.aborted) throw new Error("Request was aborted");
						if (recovery.expired()) throw recovery.deadlineError();
						finalizeUsage(output);
						assertSuccessfulCodexOutput(output);
						timing.finish("completed");
						recordUsage(diagnostics, lane, "websocket", output);
						await deps.recordUsage?.(accountId, { ...model, id: body.model }, output.usage);
						stream.push({ type: "done", reason: output.stopReason, message: output });
						return;
					} catch (error) {
						timing.finish(callerSignal?.aborted ? "aborted" : "failed");
						if (callerSignal?.aborted) throw error;
						const upgradeRequired = isWebSocketUpgradeRequiredError(error);
						const messageTooBig = isWebSocketMessageTooBigError(error);
						const unauthorized = isWebSocketUnauthorizedError(error);
						const retryableWebSocketError = (isCodexApiError(error) || !isPermanentWebSocketError(error)) && isRetryableCodexStreamError(error);
						const connectionFailure = !isCodexApiError(error) && isWebSocketConnectionError(error);
						if (retryableWebSocketError && connectionFailure) {
							recovery.start();
						}
						const retryPlan = recovery.planRetry(error, attempt + 1);
						const websocketRecoveryExhausted = recovery.expired()
							|| (retryableWebSocketError && (websocketRecoveryRetries >= MAX_WEBSOCKET_RECOVERY_RETRIES
								|| (recovery.recoveryDeadlineAt !== undefined && retryPlan.delayMs !== undefined
									&& retryPlan.delayMs >= recovery.recoveryDeadlineAt - performance.now())));
						const overloadBudgetExhausted = retryPlan.overload && retryPlan.delayMs === undefined;
						const adviceBudgetExhausted = retryPlan.adviceBudgetExhausted;
						const immediateFallback = !(error instanceof CodexProtocolError) && (upgradeRequired || messageTooBig || unauthorized);
						const fallbackArmed = immediateFallback || websocketRecoveryExhausted
							|| (retryableWebSocketError && (attempt >= streamMaxRetries || overloadBudgetExhausted));
						appendAssistantMessageDiagnostic(
							output,
							createAssistantMessageDiagnostic(retryableWebSocketError ? "provider_transport_failure" : "provider_stream_failure", error, {
								configuredTransport: preferredTransport,
								...(fallbackArmed ? { fallbackTransport: "sse" } : {}),
								eventsEmitted: websocketStarted,
								phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
								requestBytes: new TextEncoder().encode(bodyJson).byteLength,
							}),
						);
						if (!immediateFallback && !websocketRecoveryExhausted
							&& retryableWebSocketError && attempt < streamMaxRetries && !overloadBudgetExhausted && !adviceBudgetExhausted) {
							diagnostics?.({
								type: "retry",
								lane,
								transport: "websocket",
								attempt: requestTiming.nextAttempt,
								...(retryPlan.delayMs !== undefined ? { delayMs: retryPlan.delayMs } : {}),
								failure: codexDiagnosticsFailure(error),
							});
							try {
								await recovery.waitBeforeRetry(error, attempt + 1, retryPlan, true);
								continue;
							} catch (waitError) {
								if (callerSignal?.aborted || !recovery.expired()) throw waitError;
							}
						}
						if (adviceBudgetExhausted && retryableWebSocketError) {
							throw retryAdviceRecoveryBudgetError(error);
						}
						if (!fallbackArmed && !recovery.expired()) {
							recordFailure("websocket", error);
							if (websocketStarted && !(error instanceof CodexProtocolError) && !isCodexApiError(error)) {
								throw new NonRetryableProviderError("Codex stream ended after output began and cannot be continued from its incomplete response.");
							}
							throw error;
						}
						// A transport switch is still another request to the same backend.
						// SSE gets its own bounded window, never the exhausted WebSocket signal.
						recovery.start(true);
						if (!immediateFallback && (retryPlan.serverDirected || retryPlan.overload)) await recovery.waitBeforeRetry(error, attempt + 1, retryPlan);
						// A transient failure says nothing about the next request's connectivity.
						// Only known WebSocket incompatibilities justify session-wide fallback.
						if (upgradeRequired || messageTooBig) recordWebSocketSseFallback(effectiveOptions?.sessionId);
						diagnostics?.({
							type: "fallback",
							lane,
							from: "websocket",
							to: "sse",
							reason: upgradeRequired
								? "upgrade_required"
								: messageTooBig
									? "message_too_big"
									: unauthorized
										? "unauthorized"
										: "retry_budget_exhausted",
						});
						output = createInitialAssistantMessage(model);
						break;
					} finally {
						attemptSignal?.cleanup();
					}
				}
			}

			const sseIdleTimeoutMs = normalizeTimeoutMs(effectiveOptions?.timeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS, "timeoutMs");
			for (let attempt = 0; attempt <= streamMaxRetries; attempt++) {
				if (attempt > 0) output = createInitialAssistantMessage(model);
				if (callerSignal?.aborted) throw new Error("Request was aborted");
				if (recovery.expired()) throw recovery.deadlineError();
				const sseSignal = recovery.signal();
				const sseOptions = sseSignal ? { ...effectiveOptions, signal: sseSignal.signal } : effectiveOptions;
				const responseItems: unknown[] = [];
				let timing: CodexAttemptTiming | undefined;
				try {
					if (effectiveOptions?.compactionDiagnostics) {
						Object.assign(effectiveOptions.compactionDiagnostics, {
							transport: "sse",
							continuation: undefined,
							continuationMismatch: undefined,
							previousResponseId: false,
							fullInputItems: body.input.length,
							sentInputItems: body.input.length,
						});
					}
					const response = await openCodexSSE(model, sseBody, baseSseHeaders, sseOptions, deps.turnState, () => {
						timing = requestTiming.start(lane, "sse");
						diagnostics?.({
							type: "request",
							lane,
							transport: "sse",
							attempt: timing.attempt,
							requestMetadata: codexRequestDiagnostics(body, baseSseHeaders),
							fullInputItems: body.input.length,
							sentInputItems: body.input.length,
							model: body.model,
							...(canonicalHistory ? { canonicalHistory } : {}),
							...(effectiveOptions?.compactionDiagnostics ? { compaction: structuredClone(effectiveOptions.compactionDiagnostics) } : {}),
						});
						return timing;
					}, () => {
						recovery.start();
						return recovery.recoveryController?.signal;
					});
					if (!response.body) throw new Error("No response body");
					if (!streamStarted) {
						streamStarted = true;
						stream.push({ type: "start", partial: output });
					}
					await processCodexResponsesStream(
						parseSSE(response, sseOptions?.signal, sseIdleTimeoutMs),
						output,
						stream,
						model,
						{
							...sseOptions,
							onOutputItemDone: (item) => responseItems.push(item),
							onProviderStreamEvent: (event, eventModel) => {
								timing?.observe(event);
								return effectiveOptions?.onProviderStreamEvent?.(event, eventModel);
							},
						},
					);
					finalizeUsage(output);
					if (callerSignal?.aborted) throw new Error("Request was aborted");
					if (recovery.expired()) {
						const error = recovery.deadlineError();
						recordFailure("sse", error);
						throw error;
					}
					assertSuccessfulCodexOutput(output);
					timing?.finish("completed");
					recordUsage(diagnostics, lane, "sse", output);
					await deps.recordUsage?.(accountId, { ...model, id: body.model }, output.usage);
					for (const item of responseItems) effectiveOptions?.onOutputItemDone?.(item);
					if (!effectiveOptions?.canonicalCompaction) recordCanonicalSessionResponse({
						sessionId: effectiveOptions?.sessionId,
						url: resolveCodexWebSocketUrl(model.baseUrl),
						accountId,
						requestBody: body,
						reconstructedRequestBody: reconstructedBody,
						responseItems,
						token: canonicalSessionToken,
					});
					stream.push({ type: "done", reason: output.stopReason, message: output });
					return;
				} catch (error) {
					timing?.finish(callerSignal?.aborted ? "aborted" : "failed");
					if (callerSignal?.aborted) throw error;
					if (recovery.expired()) {
						const deadlineError = recovery.deadlineError();
						recordFailure("sse", deadlineError);
						throw deadlineError;
					}
					const retryable = !(error instanceof NonRetryableProviderError) && isRetryableCodexStreamError(error);
					if (retryable) recovery.start();
					const retryPlan = recovery.planRetry(error, attempt + 1);
					const overloadBudgetExhausted = retryPlan.overload && retryPlan.delayMs === undefined;
					const adviceBudgetExhausted = retryPlan.adviceBudgetExhausted;
					appendAssistantMessageDiagnostic(
						output,
						createAssistantMessageDiagnostic(retryable ? "provider_transport_failure" : "provider_stream_failure", error, {
							configuredTransport: preferredTransport,
							eventsEmitted: output.content.length > 0,
							phase: output.content.length > 0 ? "after_message_stream_start" : "before_message_stream_start",
							requestBytes: new TextEncoder().encode(bodyJson).byteLength,
						}),
					);
					if (retryable && attempt < streamMaxRetries && !overloadBudgetExhausted && !adviceBudgetExhausted) {
						diagnostics?.({
							type: "retry",
							lane,
							transport: "sse",
							attempt: requestTiming.nextAttempt,
							...(retryPlan.delayMs !== undefined ? { delayMs: retryPlan.delayMs } : {}),
							failure: codexDiagnosticsFailure(error),
						});
						await recovery.waitBeforeRetry(error, attempt + 1, retryPlan);
						continue;
					}
					if (adviceBudgetExhausted && retryable) {
						throw retryAdviceRecoveryBudgetError(error);
					}
					recordFailure("sse", error);
					if (retryable) throw new NonRetryableProviderError("Codex stream retry budget was exhausted before a response completed.");
					throw error;
				} finally {
					sseSignal?.cleanup();
				}
			}
		} catch (error) {
			if (!diagnosticsFailureRecorded) recordFailure(effectiveTransport === "sse" ? "sse" : "websocket", error);
			output.content = output.content.filter(block => block.type !== "toolCall");
			stream.push({
				type: "error",
				reason: (effectiveOptions?.signal?.aborted ? "aborted" : "error") as "aborted" | "error",
				error: createErrorMessage(output, error, !!effectiveOptions?.signal?.aborted),
			});
		} finally {
			recoveryForCleanup?.close();
			await request.close();
			deps.onStreamSettled?.();
		}
	})();

	return stream;
}
