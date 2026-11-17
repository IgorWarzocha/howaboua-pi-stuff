// Bounded labels only: request fields and item types can otherwise contain private data.
export const WEBSOCKET_REQUEST_CHANGE_REASONS = {
	model: "model_changed",
	instructions: "instructions_changed",
	tools: "tools_changed",
	tool_choice: "tool_choice_changed",
	parallel_tool_calls: "parallel_tool_calls_changed",
	reasoning: "reasoning_changed",
	store: "store_changed",
	stream: "stream_changed",
	include: "include_changed",
	service_tier: "service_tier_changed",
	prompt_cache_key: "prompt_cache_key_changed",
	text: "text_changed",
	temperature: "temperature_changed",
	access_programs: "access_programs_changed",
} as const;

export const WEBSOCKET_CONTINUATION_DECISIONS = [
	"disabled",
	"no_session_cache_entry",
	"no_continuation",
	"body_mismatch",
	"input_shorter_than_baseline",
	"input_prefix_mismatch",
	"missing_previous_response_id",
	"delta",
	...Object.values(WEBSOCKET_REQUEST_CHANGE_REASONS),
] as const;

export type WebSocketContinuationDecision =
	(typeof WEBSOCKET_CONTINUATION_DECISIONS)[number];

const RESPONSE_ITEM_TYPES = [
	"additional_tools",
	"message",
	"agent_message",
	"reasoning",
	"local_shell_call",
	"function_call",
	"function_call_output",
	"custom_tool_call",
	"custom_tool_call_output",
	"tool_search_call",
	"tool_search_output",
	"web_search_call",
	"image_generation_call",
	"compaction",
	"context_compaction",
	"configuration_update",
	"compaction_trigger",
	"other",
	"none",
] as const;

type ResponseItemType = (typeof RESPONSE_ITEM_TYPES)[number];

export interface WebSocketContinuationMismatch {
	previousItemType: ResponseItemType;
	currentItemType: ResponseItemType;
}

export function continuationItemType(item: unknown): ResponseItemType {
	if (!item || typeof item !== "object") return "other";
	const value = item as Record<string, unknown>;
	// Responses also accepts message items with an omitted type.
	if (
		value["type"] === undefined &&
		typeof value["role"] === "string" &&
		["user", "assistant", "system", "developer"].includes(value["role"])
	)
		return "message";
	return (
		RESPONSE_ITEM_TYPES.find(
			(type) => type !== "none" && type === value["type"],
		) ?? "other"
	);
}

export function isWebSocketContinuationMismatch(
	value: unknown,
): value is WebSocketContinuationMismatch {
	if (!value || typeof value !== "object") return false;
	const mismatch = value as Record<string, unknown>;
	return (
		RESPONSE_ITEM_TYPES.some((type) => type === mismatch["previousItemType"]) &&
		RESPONSE_ITEM_TYPES.some((type) => type === mismatch["currentItemType"])
	);
}
