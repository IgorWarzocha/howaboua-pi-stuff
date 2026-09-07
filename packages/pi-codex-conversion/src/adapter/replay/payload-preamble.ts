import type { ResponsesCompatibleRequestPayload } from "../compaction/compaction-runtime.ts";
import type { ResponsesInputMessageItem } from "../compaction/serializer.js";
import { areEquivalentValues, cloneResponsesInputMessageItem, isPreambleRole, isResponsesInputMessageItem } from "./payload-structured.ts";

export type FreshAuthoritativePreamble = {
	instructions?: string | undefined;
	leadingInput: ResponsesInputMessageItem[];
	trailingInput: ResponsesInputMessageItem[];
};

function isPromptEnvelopeItem(item: unknown, persisted: readonly unknown[]): item is ResponsesInputMessageItem {
	return isResponsesInputMessageItem(item) && isPreambleRole(item.role) &&
		!persisted.some((known) => areEquivalentValues(item, known));
}

export function extractFreshAuthoritativePreamble(payload: ResponsesCompatibleRequestPayload, persisted: readonly unknown[] = []): FreshAuthoritativePreamble | undefined {
	if (payload.instructions !== undefined && typeof payload.instructions !== "string") return undefined;

	let leadingBoundary = 0;
	while (leadingBoundary < payload.input.length && isPromptEnvelopeItem(payload.input[leadingBoundary]!, persisted)) leadingBoundary += 1;

	let trailingBoundary = payload.input.length;
	while (trailingBoundary > leadingBoundary && isPromptEnvelopeItem(payload.input[trailingBoundary - 1]!, persisted)) trailingBoundary -= 1;

	for (let index = leadingBoundary; index < trailingBoundary; index++) {
		if (isPromptEnvelopeItem(payload.input[index]!, persisted)) return undefined;
	}

	return {
		...(typeof payload.instructions === "string" ? { instructions: payload.instructions } : {}),
		leadingInput: payload.input.slice(0, leadingBoundary).map((item) => cloneResponsesInputMessageItem(item as ResponsesInputMessageItem)),
		trailingInput: payload.input.slice(trailingBoundary).map((item) => cloneResponsesInputMessageItem(item as ResponsesInputMessageItem)),
	};
}
