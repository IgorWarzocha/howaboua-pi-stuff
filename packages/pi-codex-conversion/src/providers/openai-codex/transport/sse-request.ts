import type { Api, Model } from "@earendil-works/pi-ai";
import type { CodexAttemptTiming } from "../diagnostic-timing.ts";
import { DEFAULT_SSE_HEADER_TIMEOUT_MS } from "../constants.ts";
import { codexRetryAfterDeadline, isRetryableStreamStatus, parseErrorResponse } from "../errors.ts";
import { CODEX_TURN_STATE_HEADER, withCodexTurnStateHeader, type CodexTurnState } from "../turn-state.ts";
import { createCodexHttpError } from "../stream-events.ts";
import { combineAbortSignals, createSSEHeaderTimeout } from "../sse.ts";
import { resolveCodexUrl, headersToRecord } from "../headers.ts";
import type { OpenAICodexStreamOptions } from "../types.ts";

export async function openCodexSSE<TApi extends Api>(
	model: Model<TApi>,
	body: string | Uint8Array,
	baseHeaders: Headers,
	options: OpenAICodexStreamOptions | undefined,
	turnState: CodexTurnState | undefined,
	startAttempt: () => CodexAttemptTiming,
	onRetryableResponse: () => AbortSignal | undefined,
): Promise<Response> {
	// The logical stream loop owns retries, including failures before headers.
	if (options?.signal?.aborted) throw new Error("Request was aborted");
	const timing = startAttempt();
	const headerTimeout = createSSEHeaderTimeout(DEFAULT_SSE_HEADER_TIMEOUT_MS);
	const combinedSignal = combineAbortSignals([options?.signal, headerTimeout.signal]);
	let response: Response;
	try {
		try {
			timing.sent();
			response = await (options?.fetch ?? fetch)(resolveCodexUrl(model.baseUrl), {
				method: "POST",
				headers: withCodexTurnStateHeader(baseHeaders, turnState),
				body,
				signal: combinedSignal.signal,
			});
		} catch (error) {
			const timeoutError = headerTimeout.error();
			throw timeoutError && !options?.signal?.aborted ? timeoutError : error;
		} finally {
			headerTimeout.clear();
		}
	} catch (error) {
		combinedSignal.cleanup();
		timing.finish(options?.signal?.aborted ? "aborted" : "failed");
		if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
			throw new Error("Request was aborted");
		}
		throw error;
	} finally {
		headerTimeout.clear();
	}

	let errorSignal: ReturnType<typeof combineAbortSignals> | undefined;
	try {
		const retryAfter = codexRetryAfterDeadline(response.headers);
		// Known failed headers start recovery even if the error body never finishes.
		// The parsed body still owns fatal-code classification, not this clock.
		if (!response.ok && isRetryableStreamStatus(response.status)) {
			errorSignal = combineAbortSignals([combinedSignal.signal, onRetryableResponse()]);
		}
		if (response.ok) turnState?.capture(response.headers.get(CODEX_TURN_STATE_HEADER));
		await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
		if (response.ok) return response;

		const info = await parseErrorResponse(response, errorSignal?.signal ?? combinedSignal.signal);
		const message = info.friendlyMessage || info.message;
		const error = createCodexHttpError(message, info.code, response.status, retryAfter);
		timing.finish("failed");
		throw error;
	} finally {
		errorSignal?.cleanup();
		combinedSignal.cleanup();
	}
}
