import type { AssistantMessage } from "@earendil-works/pi-ai";

function responsesSummary(signature: string | undefined): string | undefined {
	if (!signature) return undefined;
	try {
		const item: unknown = JSON.parse(signature);
		if (!item || typeof item !== "object" ||
			!("type" in item) || item.type !== "reasoning" ||
			!("id" in item) || typeof item.id !== "string" || !item.id ||
			!("summary" in item) || !Array.isArray(item.summary)) return undefined;
		const summaries: string[] = [];
		const parts: unknown[] = item.summary;
		for (const part of parts) {
			if (!part || typeof part !== "object" ||
				!("type" in part) || part.type !== "summary_text" ||
				!("text" in part) || typeof part.text !== "string") return undefined;
			if (part.text.trim()) summaries.push(part.text);
		}
		return summaries.length > 0 ? summaries.join("\n\n") : undefined;
	} catch {
		// Missing or malformed provenance is not permission to speak raw reasoning.
		return undefined;
	}
}

export function completedVoiceReasoningSummary(
	message: Pick<AssistantMessage, "api" | "content" | "model" | "responseModel">,
): string | undefined {
	const model = (message.responseModel ?? message.model).trim().toLowerCase();
	const responses = message.api === "openai-responses" ||
		message.api === "openai-codex-responses" || message.api === "azure-openai-responses";
	// These native APIs expose summarized thinking for these model families.
	// Other APIs, including Completions and unknown adapters, have no such guarantee.
	const nativeSummary =
		((message.api === "anthropic-messages" || message.api === "bedrock-converse-stream") &&
			/(?:^|[/.:])claude-(?:opus|sonnet|haiku|fable|mythos)-(?:4|5)(?:[.-]|$)/.test(model)) ||
		((message.api === "google-generative-ai" || message.api === "google-vertex") &&
			/(?:^|[/.:])gemini-3(?:\.\d+)?(?:[.-]|$)/.test(model));
	const summaries = message.content.flatMap((item) => {
		if (item.type !== "thinking" || item.redacted) return [];
		// Responses thinking may contain raw content. Only the wire summary is speakable.
		const summary = responses ? responsesSummary(item.thinkingSignature)
			: nativeSummary ? item.thinking : undefined;
		return summary?.trim() ? [summary] : [];
	});
	return summaries.length > 0 ? summaries.join("\n\n") : undefined;
}
