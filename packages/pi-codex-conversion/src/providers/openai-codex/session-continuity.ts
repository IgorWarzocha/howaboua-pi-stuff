import type { CanonicalHistoryDecision, ResponsesBody } from "./types.ts";
import { responseInputsEqual } from "./websocket-continuation.ts";

export type CanonicalSessionToken = {
	globalGeneration: number;
	sessionGeneration: number;
	requestSequence: number;
};

type CanonicalSessionState = {
	accountId: string;
	url: string;
	requestBody: ResponsesBody;
	reconstructedRequestInput: readonly unknown[];
	responseItems: readonly unknown[];
};

const canonicalSessions = new Map<string, CanonicalSessionState>();
const sessionGenerations = new Map<string, number>();
const sessionRequestSequences = new Map<string, number>();
let globalGeneration = 0;

function matchesLane(state: CanonicalSessionState, url: string, accountId: string, model: string): boolean {
	return state.url === url && state.accountId === accountId && state.requestBody.model === model;
}

function materializedInput(state: CanonicalSessionState): unknown[] {
	return [...state.requestBody.input, ...state.responseItems];
}

function responsesLiteRequestPrefixLength(input: readonly unknown[]): number {
	const first = input[0];
	if (!first || typeof first !== "object" || (first as { type?: unknown }).type !== "additional_tools") return 0;
	const second = input[1];
	return second && typeof second === "object" && (second as { role?: unknown }).role === "developer" ? 2 : 1;
}

function replayCanonicalInput(
	state: CanonicalSessionState,
	preparedInput: readonly unknown[],
	requestPrefixLength = 0,
): { input?: unknown[] | undefined; decision: CanonicalHistoryDecision } {
	const reconstructedRequestInput = state.reconstructedRequestInput.slice(requestPrefixLength);
	const minimumInputLength = reconstructedRequestInput.length + state.responseItems.length;
	if (preparedInput.length < minimumInputLength) {
		return { decision: "input_shorter_than_baseline" };
	}
	if (!responseInputsEqual(preparedInput.slice(0, reconstructedRequestInput.length), reconstructedRequestInput)) {
		return { decision: "request_prefix_mismatch" };
	}
	const reconstructedResponseEnd = reconstructedRequestInput.length + state.responseItems.length;
	if (!responseInputsEqual(preparedInput.slice(reconstructedRequestInput.length, reconstructedResponseEnd), state.responseItems)) {
		return { decision: "response_prefix_mismatch" };
	}
	return {
		input: [
			...structuredClone(materializedInput(state)),
			...structuredClone(preparedInput.slice(reconstructedResponseEnd)),
		],
		decision: "replayed",
	};
}

export function recordCanonicalSessionResponse(args: {
	sessionId?: string | undefined;
	url: string;
	accountId: string;
	requestBody: ResponsesBody;
	reconstructedRequestBody?: ResponsesBody | undefined;
	responseItems: readonly unknown[];
	token?: CanonicalSessionToken | undefined;
}): void {
	if (!args.sessionId) return;
	if (args.token && !canonicalSessionTokenMatches(args.sessionId, args.token)) return;
	canonicalSessions.set(args.sessionId, {
		accountId: args.accountId,
		url: args.url,
		requestBody: structuredClone(args.requestBody),
		reconstructedRequestInput: structuredClone((args.reconstructedRequestBody ?? args.requestBody).input),
		responseItems: structuredClone(args.responseItems),
	});
}

export function captureCanonicalSessionToken(sessionId: string | undefined): CanonicalSessionToken | undefined {
	if (!sessionId) return undefined;
	const requestSequence = (sessionRequestSequences.get(sessionId) ?? 0) + 1;
	sessionRequestSequences.set(sessionId, requestSequence);
	return {
		globalGeneration,
		sessionGeneration: sessionGenerations.get(sessionId) ?? 0,
		requestSequence,
	};
}

function canonicalSessionTokenMatches(sessionId: string, token: CanonicalSessionToken): boolean {
	return token.globalGeneration === globalGeneration
		&& token.sessionGeneration === (sessionGenerations.get(sessionId) ?? 0)
		&& token.requestSequence === (sessionRequestSequences.get(sessionId) ?? 0);
}

export function buildCanonicalSessionRequest(
	sessionId: string | undefined,
	url: string,
	accountId: string,
	preparedBody: ResponsesBody,
): { body: ResponsesBody; decision?: CanonicalHistoryDecision | undefined } {
	if (!sessionId) return { body: preparedBody };
	const state = canonicalSessions.get(sessionId);
	if (!state) return { body: preparedBody };
	if (!matchesLane(state, url, accountId, preparedBody.model)) {
		return { body: preparedBody, decision: "identity_mismatch" };
	}

	const replay = replayCanonicalInput(state, preparedBody.input);
	if (!replay.input) return { body: preparedBody, decision: replay.decision };
	return {
		body: {
			...preparedBody,
			input: replay.input,
		},
		decision: replay.decision,
	};
}

export function canonicalCompactionPromptInput(
	sessionId: string,
	model: string,
	identity?: { url: string; accountId: string } | undefined,
	reconstructedInput?: readonly unknown[] | undefined,
): unknown[] | undefined {
	const state = canonicalSessions.get(sessionId);
	if (!state || state.requestBody.model !== model) return undefined;
	if (identity && (state.url !== identity.url || state.accountId !== identity.accountId)) return undefined;
	if (!reconstructedInput) return structuredClone(materializedInput(state));
	return replayCanonicalInput(
		state,
		reconstructedInput,
		responsesLiteRequestPrefixLength(state.reconstructedRequestInput),
	).input;
}

export function canonicalCompactionRequestBody(
	sessionId: string,
	model: string,
	identity: { url: string; accountId: string },
): ResponsesBody | undefined {
	const state = canonicalSessions.get(sessionId);
	if (!state || !matchesLane(state, identity.url, identity.accountId, model)) return undefined;
	const body = structuredClone({ ...state.requestBody, input: [] });
	delete body.previous_response_id;
	return body;
}

export function clearCanonicalSessions(sessionId?: string): void {
	if (sessionId) {
		canonicalSessions.delete(sessionId);
		sessionGenerations.set(sessionId, (sessionGenerations.get(sessionId) ?? 0) + 1);
		sessionRequestSequences.delete(sessionId);
		return;
	}
	canonicalSessions.clear();
	sessionGenerations.clear();
	sessionRequestSequences.clear();
	globalGeneration++;
}
