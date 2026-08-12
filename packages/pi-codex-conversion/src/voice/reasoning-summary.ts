import type { AssistantMessage } from "@earendil-works/pi-ai";

const SUMMARY_MODEL_PATTERNS = [
	/(?:^|[/.:])gpt-5(?:[.-]|$)/,
	/(?:^|[/.:])claude-(?:opus|sonnet|haiku|fable|mythos)-(?:4|5)(?:[.-]|$)/,
	/(?:^|[/.:])gemini-3(?:\.\d+)?(?:[.-]|$)/,
	/(?:^|[/.:])grok-4\.5(?:[.-]|$)/,
] as const;

export function completedVoiceReasoningSummary(
	message: Pick<AssistantMessage, "content" | "model" | "responseModel">,
): string | undefined {
	const model = (message.responseModel ?? message.model).trim().toLowerCase();
	if (!SUMMARY_MODEL_PATTERNS.some((pattern) => pattern.test(model))) return undefined;
	const summaries = message.content.flatMap((item) =>
		item.type === "thinking" && item.thinking.trim() ? [item.thinking] : [],
	);
	return summaries.length > 0 ? summaries.join("\n\n") : undefined;
}
