import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface CodexLikeModelDescriptor {
	provider: string;
	api: string;
	id: string;
}

export function isOpenAICodexModel(model: Partial<CodexLikeModelDescriptor> | null | undefined): boolean {
	if (!model) return false;
	return (model.provider ?? "").toLowerCase() === "openai-codex";
}

export function isResponsesModel(model: Partial<CodexLikeModelDescriptor> | null | undefined): boolean {
	if (!model) return false;
	return (model.api ?? "").toLowerCase().includes("responses");
}

// Keep model detection intentionally conservative. The adapter replaces the
// system prompt and tool surface, so false positives are worse than misses.
export function isCodexLikeModel(model: Partial<CodexLikeModelDescriptor> | null | undefined): boolean {
	if (!model) return false;

	const provider = (model.provider ?? "").toLowerCase();
	const api = (model.api ?? "").toLowerCase();
	const id = (model.id ?? "").toLowerCase();
	const isCopilotGpt = (provider.includes("copilot") || api.includes("copilot")) && id.includes("gpt");
	return provider.includes("codex") || api.includes("codex") || id.includes("codex") || (provider.includes("openai") && id.includes("gpt")) || isCopilotGpt;
}

export function isCodexLikeContext(ctx: ExtensionContext): boolean {
	return isCodexLikeModel(ctx.model);
}

export function isOpenAICodexContext(ctx: ExtensionContext): boolean {
	return isOpenAICodexModel(ctx.model);
}

export function isResponsesContext(ctx: ExtensionContext): boolean {
	return isResponsesModel(ctx.model);
}
