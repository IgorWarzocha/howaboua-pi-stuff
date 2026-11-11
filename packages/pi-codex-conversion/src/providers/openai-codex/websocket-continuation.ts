import type { CachedWebSocketContinuationState, CachedWebSocketRequestBodyResult, ResponsesBody, WebSocketContinuationDecision } from "./types.ts";
import { continuationItemType, WEBSOCKET_REQUEST_CHANGE_REASONS, type WebSocketContinuationMismatch } from "./continuation-diagnostics.ts";

export function requestBodyForWebSocketContinuationComparison(body: ResponsesBody): ResponsesBody {
	const {
		input: _input,
		previous_response_id: _previousResponseId,
		// Request metadata may carry per-turn transport fields such as the
		// Responses Lite marker. It does not change conversation continuity.
		client_metadata: _clientMetadata,
		...rest
	} = body;
	return rest as ResponsesBody;
}

export function responseInputsEqual(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return left.length === right.length && left.every((item, index) => responsesValuesEqual(item, right[index]));
}

function comparableResponseField(record: Record<string, unknown>, key: string): boolean {
	if (key === "internal_chat_message_metadata_passthrough") return false;
	if (key === "logprobs" && record["type"] === "output_text" && Array.isArray(record[key]) && record[key].length === 0) return false;
	if (key === "status" && record[key] === "completed" && (record["type"] === "function_call" || record["type"] === "custom_tool_call")) return false;
	const value = record[key];
	// JSON omits these object fields, but represents them as null in arrays.
	return value !== undefined && typeof value !== "function" && typeof value !== "symbol";
}

function responsesValuesEqual(a: unknown, b: unknown, arrayItem = false): boolean {
	if (typeof a === "function" || typeof a === "symbol") a = undefined;
	if (typeof b === "function" || typeof b === "symbol") b = undefined;
	if (typeof a === "number" && !Number.isFinite(a)) a = null;
	if (typeof b === "number" && !Number.isFinite(b)) b = null;
	if (arrayItem) {
		a ??= null;
		b ??= null;
	}
	if (a === b) return true;
	if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let index = 0; index < a.length; index++) {
			if (!responsesValuesEqual(a[index], b[index], true)) return false;
		}
		return true;
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left).filter(key => comparableResponseField(left, key));
	if (keys.length !== Object.keys(right).filter(key => comparableResponseField(right, key)).length) return false;
	// Compare in place: canonical copies and JSON strings amplify large tool/image inputs.
	return keys.every(key => Object.hasOwn(right, key) && comparableResponseField(right, key)
		&& responsesValuesEqual(left[key], right[key]));
}

function requestBodyMismatch(previous: ResponsesBody, current: ResponsesBody): WebSocketContinuationDecision | undefined {
	const before = requestBodyForWebSocketContinuationComparison(previous);
	const after = requestBodyForWebSocketContinuationComparison(current);
	if (responsesValuesEqual(before, after)) return undefined;
	for (const [field, reason] of Object.entries(WEBSOCKET_REQUEST_CHANGE_REASONS)) {
		if (!responsesValuesEqual(before[field], after[field])) return reason;
	}
	// Payload hooks can add fields. Preserve the comparison without logging arbitrary keys.
	return "body_mismatch";
}

function getFunctionCallId(item: unknown): string | undefined {
	return item && typeof item === "object" && ((item as { type?: unknown }).type === "function_call" || (item as { type?: unknown }).type === "custom_tool_call") && typeof (item as { call_id?: unknown }).call_id === "string"
		? (item as { call_id: string }).call_id
		: undefined;
}

function getFunctionCallOutputId(item: unknown): string | undefined {
	return item && typeof item === "object" && ((item as { type?: unknown }).type === "function_call_output" || (item as { type?: unknown }).type === "custom_tool_call_output") && typeof (item as { call_id?: unknown }).call_id === "string"
		? (item as { call_id: string }).call_id
		: undefined;
}

function getPendingToolOutputDelta(body: ResponsesBody, continuation: CachedWebSocketContinuationState): unknown[] | undefined {
	const pendingCallIds = continuation.lastResponseItems.map(getFunctionCallId).filter((id): id is string => id !== undefined);
	if (pendingCallIds.length === 0) return undefined;

	const pending = new Set(pendingCallIds);
	const currentInput = body.input ?? [];
	let firstOutputIndex: number | undefined;
	for (const [index, item] of currentInput.entries()) {
		const callId = getFunctionCallOutputId(item);
		if (!callId || !pending.has(callId)) continue;
		firstOutputIndex ??= index;
		pending.delete(callId);
	}

	return pending.size === 0 && firstOutputIndex !== undefined ? currentInput.slice(firstOutputIndex) : undefined;
}

function getCachedWebSocketInputDelta(body: ResponsesBody, continuation: CachedWebSocketContinuationState): { delta?: unknown[] | undefined; decision: WebSocketContinuationDecision; mismatch?: WebSocketContinuationMismatch | undefined } {
	const bodyMismatch = requestBodyMismatch(continuation.lastRequestBody, body);
	if (bodyMismatch) return { decision: bodyMismatch };

	const currentInput = body.input ?? [];
	const baseline = [...(continuation.lastRequestBody.input ?? []), ...continuation.lastResponseItems];
	if (currentInput.length < baseline.length) {
		return { decision: "input_shorter_than_baseline", mismatch: {
			previousItemType: continuationItemType(baseline[currentInput.length]),
			currentItemType: "none",
		} };
	}

	const mismatchIndex = baseline.findIndex((item, index) => !responsesValuesEqual(item, currentInput[index]));
	if (mismatchIndex !== -1) {
		const pendingToolOutputDelta = getPendingToolOutputDelta(body, continuation);
		if (pendingToolOutputDelta) {
			return { delta: pendingToolOutputDelta, decision: "delta" };
		}
		return { decision: "input_prefix_mismatch", mismatch: {
			previousItemType: continuationItemType(baseline[mismatchIndex]),
			currentItemType: continuationItemType(currentInput[mismatchIndex]),
		} };
	}

	return { delta: currentInput.slice(baseline.length), decision: "delta" };
}

export function buildCachedWebSocketRequestBody(continuation: CachedWebSocketContinuationState | undefined, body: ResponsesBody): CachedWebSocketRequestBodyResult {
	if (!continuation) {
		return { body, decision: "no_continuation" };
	}

	const { delta, decision, mismatch } = getCachedWebSocketInputDelta(body, continuation);
	if (!delta) {
		return { body, decision, ...(mismatch ? { mismatch } : {}) };
	}
	if (!continuation.lastResponseId) {
		return { body, decision: "missing_previous_response_id" };
	}

	return {
		body: {
			...body,
			previous_response_id: continuation.lastResponseId,
			input: delta,
		},
		decision: "delta",
	};
}
