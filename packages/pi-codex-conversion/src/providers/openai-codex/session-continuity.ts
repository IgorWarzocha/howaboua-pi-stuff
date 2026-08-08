import type { ResponsesBody } from "./types.ts";

type CanonicalSessionState = {
	accountId: string;
	url: string;
	requestBody: ResponsesBody;
	responseItems: readonly unknown[];
};

const canonicalSessions = new Map<string, CanonicalSessionState>();

function matchesLane(state: CanonicalSessionState, url: string, accountId: string, model: string): boolean {
	return state.url === url && state.accountId === accountId && state.requestBody.model === model;
}

function materializedInput(state: CanonicalSessionState): unknown[] {
	return [...state.requestBody.input, ...state.responseItems];
}

export function recordCanonicalSessionResponse(args: {
	sessionId?: string | undefined;
	url: string;
	accountId: string;
	requestBody: ResponsesBody;
	responseItems: readonly unknown[];
}): void {
	if (!args.sessionId) return;
	canonicalSessions.set(args.sessionId, {
		accountId: args.accountId,
		url: args.url,
		requestBody: args.requestBody,
		responseItems: [...args.responseItems],
	});
}

export function canonicalCompactionPromptInput(
	sessionId: string,
	model: string,
	identity?: { url: string; accountId: string } | undefined,
): unknown[] | undefined {
	const state = canonicalSessions.get(sessionId);
	if (!state || state.requestBody.model !== model) return undefined;
	if (identity && (state.url !== identity.url || state.accountId !== identity.accountId)) return undefined;
	return structuredClone(materializedInput(state));
}

export function buildCanonicalCompactionRequest(
	sessionId: string | undefined,
	url: string,
	accountId: string,
	preparedBody: ResponsesBody,
): ResponsesBody | undefined {
	if (!sessionId) return undefined;
	const state = canonicalSessions.get(sessionId);
	if (!state || !matchesLane(state, url, accountId, preparedBody.model)) return undefined;
	const {
		previous_response_id: _previousResponseId,
		client_metadata: _previousClientMetadata,
		...canonicalProperties
	} = state.requestBody;
	return {
		...structuredClone(canonicalProperties),
		...(preparedBody.client_metadata ? { client_metadata: structuredClone(preparedBody.client_metadata) } : {}),
		input: [...structuredClone(materializedInput(state)), { type: "compaction_trigger" }],
	};
}

export function clearCanonicalSessions(sessionId?: string): void {
	if (sessionId) {
		canonicalSessions.delete(sessionId);
		return;
	}
	canonicalSessions.clear();
}
