export type CodexCompactionInputSource = "canonical" | "reconstructed";

export type CodexCompactionContinuation =
	| "disabled"
	| "no_session_cache_entry"
	| "no_continuation"
	| "body_mismatch"
	| "input_shorter_than_baseline"
	| "input_prefix_mismatch"
	| "missing_previous_response_id"
	| "delta";

export type CodexCompactionReplayDecision =
	| "validated"
	| "not_applicable"
	| "no_state"
	| "model_mismatch"
	| "identity_mismatch"
	| "input_shorter_than_baseline"
	| "request_prefix_mismatch"
	| "response_prefix_mismatch";

export type CodexCompactionDiagnostic = {
	model?: string | undefined;
	inputSource: CodexCompactionInputSource;
	canonicalReplay: CodexCompactionReplayDecision;
	checkpointReused: boolean;
	checkpointModel?: string | undefined;
	transport?: "websocket" | "sse" | undefined;
	continuation?: CodexCompactionContinuation | undefined;
	previousResponseId?: boolean | undefined;
	fullInputItems?: number | undefined;
	sentInputItems?: number | undefined;
	rewrittenToolOutputs?: number | undefined;
};

const COMPACTION_INPUT_SOURCES = ["canonical", "reconstructed"] as const;
const COMPACTION_CONTINUATIONS = [
	"disabled",
	"no_session_cache_entry",
	"no_continuation",
	"body_mismatch",
	"input_shorter_than_baseline",
	"input_prefix_mismatch",
	"missing_previous_response_id",
	"delta",
] as const;
const COMPACTION_REPLAY_DECISIONS = [
	"validated",
	"not_applicable",
	"no_state",
	"model_mismatch",
	"identity_mismatch",
	"input_shorter_than_baseline",
	"request_prefix_mismatch",
	"response_prefix_mismatch",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isOptionalNonNegativeNumber(value: unknown): value is number | undefined {
	return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

export function isCodexCompactionDiagnostic(value: unknown): value is CodexCompactionDiagnostic {
	if (!isRecord(value)) return false;
	return isOneOf(COMPACTION_INPUT_SOURCES, value["inputSource"])
		&& isOneOf(COMPACTION_REPLAY_DECISIONS, value["canonicalReplay"])
		&& typeof value["checkpointReused"] === "boolean"
		&& isOptionalString(value["model"])
		&& isOptionalString(value["checkpointModel"])
		&& (value["transport"] === undefined || value["transport"] === "websocket" || value["transport"] === "sse")
		&& (value["continuation"] === undefined || isOneOf(COMPACTION_CONTINUATIONS, value["continuation"]))
		&& (value["previousResponseId"] === undefined || typeof value["previousResponseId"] === "boolean")
		&& isOptionalNonNegativeNumber(value["fullInputItems"])
		&& isOptionalNonNegativeNumber(value["sentInputItems"])
		&& isOptionalNonNegativeNumber(value["rewrittenToolOutputs"]);
}

export const COMPACTION_CACHE_DIAGNOSTIC_THRESHOLD = 0.8;

function readable(value: string): string {
	return value.replaceAll("_", " ");
}

export function formatCompactionCacheDiagnostic(
	usage: { inputTokens: number; cachedInputTokens: number },
	diagnostic: CodexCompactionDiagnostic | undefined,
): string | undefined {
	if (!isCodexCompactionDiagnostic(diagnostic) || usage.inputTokens <= 0) return undefined;
	if (usage.cachedInputTokens / usage.inputTokens >= COMPACTION_CACHE_DIAGNOSTIC_THRESHOLD) return undefined;

	const reasons: string[] = [];
	if (diagnostic.inputSource === "reconstructed") {
		reasons.push(`reconstructed history: ${readable(diagnostic.canonicalReplay)}`);
	} else {
		reasons.push("canonical replay");
	}
	if (diagnostic.transport === "sse") {
		reasons.push("SSE full request");
	} else if (diagnostic.transport === "websocket") {
		if (diagnostic.continuation === "delta") reasons.push("WS delta");
		else reasons.push(`WS full: ${readable(diagnostic.continuation ?? "no_continuation")}`);
	}
	if (diagnostic.checkpointReused) {
		reasons.push(`checkpoint reused${diagnostic.checkpointModel ? ` (recorded model ${diagnostic.checkpointModel})` : ""}`);
	}
	if (diagnostic.rewrittenToolOutputs) {
		reasons.push(`${diagnostic.rewrittenToolOutputs} tool output${diagnostic.rewrittenToolOutputs === 1 ? "" : "s"} shortened`);
	}
	return `(${reasons.join("; ")})`;
}
