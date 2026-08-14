import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface CodexLikeModelDescriptor {
	provider: string;
	api: string;
	id: string;
	baseUrl: string;
}

export function isOpenAICodexModel(model: Partial<CodexLikeModelDescriptor> | null | undefined): boolean {
	if (!model) return false;
	return (model.provider ?? "").toLowerCase() === "openai-codex";
}

export function isCanonicalCodexBaseUrl(value: string | null | undefined): boolean {
	if (!value?.trim()) return false;
	try {
		const url = new URL(value);
		const path = url.pathname.replace(/\/+$/, "");
		return url.protocol === "https:"
			&& url.hostname === "chatgpt.com"
			&& url.port === ""
			&& url.username === ""
			&& url.password === ""
			&& url.search === ""
			&& url.hash === ""
			&& (path === "/backend-api" || path === "/backend-api/codex");
	} catch {
		return false;
	}
}

export function isCanonicalCodexSubscriptionModel(
	model: Partial<CodexLikeModelDescriptor> | null | undefined,
): boolean {
	return Boolean(model
		&& model.api === "openai-codex-responses"
		&& isCanonicalCodexBaseUrl(model.baseUrl));
}

export function isCanonicalCodexAliasModel(
	model: Partial<CodexLikeModelDescriptor> | null | undefined,
): boolean {
	return !isOpenAICodexModel(model) && isCanonicalCodexSubscriptionModel(model);
}

export function canonicalCodexAliasModelKey(model: Partial<CodexLikeModelDescriptor>): string {
	return JSON.stringify([model.provider, model.api, model.id, model.baseUrl]);
}

export function isCodexTransportModel(
	model: Partial<CodexLikeModelDescriptor> | null | undefined,
): boolean {
	return isOpenAICodexModel(model) || isCanonicalCodexSubscriptionModel(model);
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

export function isCanonicalCodexSubscriptionContext(ctx: Pick<ExtensionContext, "model">): boolean {
	return isCanonicalCodexSubscriptionModel(ctx.model);
}

export function isOpenAICodexContext(ctx: Pick<ExtensionContext, "model">): boolean {
	return isOpenAICodexModel(ctx.model);
}

export function isCodexTransportContext(ctx: Pick<ExtensionContext, "model">): boolean {
	return isOpenAICodexContext(ctx) || isCanonicalCodexSubscriptionContext(ctx);
}

export function isResponsesContext(ctx: Pick<ExtensionContext, "model">): boolean {
	return isResponsesModel(ctx.model);
}

export function isOpenAIResponsesContext(ctx: Pick<ExtensionContext, "model">): boolean {
	return (ctx.model?.api ?? "").trim().toLowerCase() === "openai-responses";
}
