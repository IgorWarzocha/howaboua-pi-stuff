import type { CachedWebSocketContinuationState, CachedWebSocketRequestBodyResult, ResponsesBody, WebSocketContinuationDecision } from "./types.ts";

export function requestBodyForWebSocketContinuationComparison(body: ResponsesBody): ResponsesBody {
	const {
		input: _input,
		previous_response_id: _previousResponseId,
		// Reasoning is a per-turn generation option. It is not part of the
		// session/thread prompt cache key, and the Responses API accepts it on the
		// follow-up request alongside previous_response_id. Keep WebSocket
		// continuation reuse when the user only changes thinking level.
		reasoning: _reasoning,
		...rest
	} = body;
	return rest as ResponsesBody;
}

function responseInputsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
	return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function requestBodiesMatchExceptInput(a: ResponsesBody, b: ResponsesBody): boolean {
	return JSON.stringify(requestBodyForWebSocketContinuationComparison(a)) === JSON.stringify(requestBodyForWebSocketContinuationComparison(b));
}

function getFunctionCallId(item: unknown): string | undefined {
	return item && typeof item === "object" && (item as { type?: unknown }).type === "function_call" && typeof (item as { call_id?: unknown }).call_id === "string"
		? (item as { call_id: string }).call_id
		: undefined;
}

function getFunctionCallOutputId(item: unknown): string | undefined {
	return item && typeof item === "object" && (item as { type?: unknown }).type === "function_call_output" && typeof (item as { call_id?: unknown }).call_id === "string"
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

function getCachedWebSocketInputDelta(body: ResponsesBody, continuation: CachedWebSocketContinuationState): { delta?: unknown[] | undefined; decision: WebSocketContinuationDecision } {
	if (!requestBodiesMatchExceptInput(body, continuation.lastRequestBody)) {
		return { decision: "body_mismatch" };
	}

	const currentInput = body.input ?? [];
	const baseline = [...(continuation.lastRequestBody.input ?? []), ...continuation.lastResponseItems];
	if (currentInput.length < baseline.length) {
		return { decision: "input_shorter_than_baseline" };
	}

	const prefix = currentInput.slice(0, baseline.length);
	if (!responseInputsEqual(prefix, baseline)) {
		const pendingToolOutputDelta = getPendingToolOutputDelta(body, continuation);
		if (pendingToolOutputDelta) {
			return { delta: pendingToolOutputDelta, decision: "delta" };
		}
		return { decision: "input_prefix_mismatch" };
	}

	return { delta: currentInput.slice(baseline.length), decision: "delta" };
}

export function buildCachedWebSocketRequestBody(continuation: CachedWebSocketContinuationState | undefined, body: ResponsesBody): CachedWebSocketRequestBodyResult {
	if (!continuation) {
		return { body, decision: "no_continuation" };
	}

	const { delta, decision } = getCachedWebSocketInputDelta(body, continuation);
	if (!delta) {
		return { body, decision };
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
