import { processResponsesStream } from "../openai-responses/shared.ts";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { CODEX_RESPONSE_STATUSES, DEFAULT_MAX_RETRY_DELAY_MS, DEFAULT_OVERLOAD_INITIAL_RETRY_DELAY_MS, DEFAULT_OVERLOAD_RECOVERY_BUDGET_MS, DEFAULT_OVERLOAD_RETRY_DELAY_MS, DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS } from "./constants.ts";
import { isRetryableStreamStatus, isTerminalRateLimitError } from "./errors.ts";
import { applyServiceTierPricing, resolveCodexServiceTier } from "./usage.ts";
import type { OpenAICodexStreamOptions, ServiceTier, StreamEventShape } from "./types.ts";

const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached";
const PREVIOUS_RESPONSE_NOT_FOUND_CODE = "previous_response_not_found";
const OVERLOAD_CODEX_ERROR_CODES = new Set(["server_is_overloaded", "slow_down"]);
const RETRYABLE_CODEX_ERROR_CODES = new Set([
	WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE,
	PREVIOUS_RESPONSE_NOT_FOUND_CODE,
	"rate_limit_exceeded",
	"server_is_overloaded",
	"slow_down",
]);
const FATAL_CODEX_ERROR_CODES = new Set([
	"bio_policy",
	"context_length_exceeded",
	"cyber_policy",
	"insufficient_quota",
	"invalid_prompt",
	"invalid_request",
	"invalid_request_error",
	"usage_not_included",
	"usage_limit_reached",
]);

class CodexApiError extends Error {
	readonly code?: string | undefined;
	readonly payload?: StreamEventShape | undefined;
	readonly retryable: boolean;
	readonly retryDelayMs?: number | undefined;
	readonly status?: number | undefined;

	constructor(message: string, options?: { code?: string | undefined; payload?: StreamEventShape | undefined; retryable?: boolean | undefined; retryDelayMs?: number | undefined; status?: number | undefined }) {
		super(message);
		this.name = "CodexApiError";
		this.code = options?.code;
		this.payload = options?.payload;
		this.retryable = options?.retryable ?? false;
		this.retryDelayMs = options?.retryDelayMs;
		this.status = options?.status;
	}
}

class CodexRetryableStreamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexRetryableStreamError";
	}
}

export class CodexProtocolError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "CodexProtocolError";
	}
}

export function isRetryableCodexStreamError(error: unknown): boolean {
	if (error instanceof CodexApiError) return error.retryable;
	return !(error instanceof CodexProtocolError);
}

export function isCodexApiError(error: unknown): boolean {
	return error instanceof CodexApiError;
}

export function codexStreamRetryDelay(error: unknown): number | undefined {
	return error instanceof CodexApiError ? error.retryDelayMs : undefined;
}

export function createCodexHttpError(message: string, code: string | undefined, status: number): Error {
	return new CodexApiError(message, {
		...(code ? { code } : {}),
		status,
		retryable: !(code && FATAL_CODEX_ERROR_CODES.has(code)) && isRetryableStreamStatus(status),
	});
}

export function isCodexOverloadError(error: unknown): boolean {
	return error instanceof CodexApiError && !!error.code && OVERLOAD_CODEX_ERROR_CODES.has(error.code);
}

export function isCodexRateLimitError(error: unknown): boolean {
	return error instanceof CodexApiError && error.code === "rate_limit_exceeded";
}

export function codexOverloadRetryDelay(error: unknown, retryCount: number, waitedMs: number): number | undefined {
	if (!isCodexOverloadError(error)) return undefined;
	const remainingMs = Math.max(0, DEFAULT_OVERLOAD_RECOVERY_BUDGET_MS - waitedMs);
	if (remainingMs === 0) return undefined;
	const defaultDelayMs = retryCount === 0 ? DEFAULT_OVERLOAD_INITIAL_RETRY_DELAY_MS : DEFAULT_OVERLOAD_RETRY_DELAY_MS;
	const requestedDelayMs = Math.max(defaultDelayMs, codexStreamRetryDelay(error) ?? 0);
	return Math.min(DEFAULT_MAX_RETRY_DELAY_MS, remainingMs, requestedDelayMs);
}

export function codexRateLimitRetryDelay(error: unknown, fallbackDelayMs: number, waitedMs: number): number | undefined {
	if (!isCodexRateLimitError(error)) return undefined;
	const requestedDelayMs = codexStreamRetryDelay(error) ?? fallbackDelayMs;
	const remainingMs = Math.max(0, DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS - waitedMs);
	return requestedDelayMs <= remainingMs ? requestedDelayMs : undefined;
}

export function assertSuccessfulCodexOutput(
	output: AssistantMessage,
): asserts output is AssistantMessage & { stopReason: "stop" | "length" | "toolUse" } {
	if (output.stopReason === "pending") {
		throw new CodexRetryableStreamError("Responses stream ended with a pending result");
	}
	if (output.stopReason === "aborted" || output.stopReason === "error") {
		throw new CodexProtocolError(output.errorMessage || "Responses stream ended without a successful result");
	}
}

export function assertSuccessfulCodexStatus(status: string | undefined): asserts status is "completed" {
	if (status === "completed") return;
	if (!status || status === "queued" || status === "in_progress") {
		throw new CodexRetryableStreamError("Responses stream ended with a pending result");
	}
	if (status === "failed" || status === "cancelled") {
		throw new CodexProtocolError("Responses stream ended without a successful result");
	}
	throw new CodexProtocolError(`Unhandled Codex response status: ${status}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function recordStatus(record: Record<string, unknown> | undefined): number | undefined {
	const status = record?.["status"] ?? record?.["status_code"] ?? record?.["statusCode"];
	const parsed = typeof status === "string" && /^\d+$/.test(status) ? Number(status) : status;
	return typeof parsed === "number" && Number.isInteger(parsed) ? parsed : undefined;
}

function eventStatus(event: StreamEventShape): number | undefined {
	const eventError = isRecord(event["error"]) ? event["error"] : undefined;
	const response = isRecord(event.response) ? event.response : undefined;
	const responseError = isRecord(response?.["error"]) ? response["error"] : undefined;
	return recordStatus(event) ?? recordStatus(eventError) ?? recordStatus(responseError) ?? recordStatus(response);
}

function isRetryableCodexApiFailure(code: string | undefined, message: string | undefined, status: number | undefined, defaultRetryable: boolean): boolean {
	if (code === "rate_limit_exceeded" && isTerminalRateLimitError(`${code} ${message ?? ""}`)) return false;
	if (code && RETRYABLE_CODEX_ERROR_CODES.has(code)) return true;
	if (code && FATAL_CODEX_ERROR_CODES.has(code)) return false;
	if (status !== undefined) return isRetryableStreamStatus(status);
	return defaultRetryable;
}

function codexApiRetryDelayMs(code: string | undefined, message: string | undefined): number | undefined {
	if ((!code || (code !== "rate_limit_exceeded" && !OVERLOAD_CODEX_ERROR_CODES.has(code))) || !message) return undefined;
	const match = /try again in\s*(\d+(?:\.\d+)?)\s*(s|ms|seconds?)/i.exec(message);
	if (!match?.[1] || !match[2]) return undefined;
	const value = Number(match[1]);
	if (!Number.isFinite(value) || value < 0) return undefined;
	const delayMs = match[2].toLowerCase() === "ms" ? value : value * 1000;
	return Number.isFinite(delayMs) ? delayMs : undefined;
}

function extractCodexEventError(event: StreamEventShape): { code?: string | undefined; message?: string | undefined } {
	const nested = isRecord(event["error"]) ? event["error"] : undefined;
	return {
		code: typeof event.code === "string"
			? event.code
			: typeof nested?.["code"] === "string"
				? nested["code"]
				: typeof nested?.["type"] === "string"
					? nested["type"]
					: undefined,
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
			const status = eventStatus(event);
			const retryDelayMs = codexApiRetryDelayMs(code, message);
			throw new CodexApiError(`Codex error: ${message || code || JSON.stringify(event)}`, {
				code,
				payload: event,
				retryable: isRetryableCodexApiFailure(code, message, status, true),
				...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
				...(status !== undefined ? { status } : {}),
			});
		}

		if (type === "response.failed") {
			const error = isRecord(event.response?.error) ? event.response.error : undefined;
			const code = typeof error?.["code"] === "string"
				? error["code"]
				: typeof error?.["type"] === "string"
					? error["type"]
					: undefined;
			const message = typeof error?.["message"] === "string" ? error["message"] : undefined;
			const status = eventStatus(event);
			const retryDelayMs = codexApiRetryDelayMs(code, message);
			throw new CodexApiError(message || "Codex response failed", {
				code,
				payload: event,
				retryable: isRetryableCodexApiFailure(code, message, status, true),
				...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
				...(status !== undefined ? { status } : {}),
			});
		}

		if (type === "response.incomplete") {
			const reason = event.response?.["incomplete_details"];
			const detail = reason && typeof reason === "object" && typeof (reason as { reason?: unknown }).reason === "string"
				? (reason as { reason: string }).reason
				: "unknown";
			throw new CodexRetryableStreamError(`Incomplete response returned, reason: ${detail}`);
		}

		if (type === "response.done" || type === "response.completed") {
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
		...(options?.grammarToolInputProperties
			? { grammarToolInputProperties: options.grammarToolInputProperties }
			: {}),
		...(options?.onOutputItemDone ? { onOutputItemDone: options.onOutputItemDone } : {}),
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
