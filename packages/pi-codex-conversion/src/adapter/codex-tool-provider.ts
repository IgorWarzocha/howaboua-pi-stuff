import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_BASE_URL } from "../providers/openai-codex/constants.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";

export const CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE = "web_run requires an OpenAI Codex-compatible Responses provider";

export interface CodexToolProvider {
	baseUrl: string;
	model: string | undefined;
	token: string;
	accountId: string;
}

export function resolveCodexApiProviderBaseUrl(modelBaseUrl: string | undefined): string {
	const base = modelBaseUrl?.trim() || `${DEFAULT_CODEX_BASE_URL}/codex`;
	const normalized = base.replace(/\/+$/, "");
	try {
		const url = new URL(normalized);
		if (url.pathname === "" || url.pathname === "/") return `${normalized}/api/codex`;
	} catch {
		// Keep string-only fallback below.
	}
	if (normalized.endsWith("/codex/responses")) return normalized.slice(0, -"/responses".length);
	if (normalized.endsWith("/codex")) return normalized;
	if (normalized.endsWith("/backend-api") || normalized.endsWith("/api")) return `${normalized}/codex`;
	return normalized;
}

export function resolveCodexAlphaSearchUrl(providerBaseUrl: string): string {
	const base = providerBaseUrl.replace(/\/+$/, "");
	if (base.endsWith("/alpha/search")) return base;
	return `${resolveCodexApiProviderBaseUrl(base)}/alpha/search`;
}

export async function resolveCodexToolProvider(ctx: ExtensionContext): Promise<CodexToolProvider> {
	if (!ctx.model) throw new Error(CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);
	const token = auth.apiKey ?? auth.headers?.["Authorization"]?.replace(/^Bearer\s+/i, "");
	if (!token) throw new Error(CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE);
	return {
		baseUrl: resolveCodexApiProviderBaseUrl(ctx.model.baseUrl),
		model: ctx.model.id,
		token,
		accountId: auth.headers?.["chatgpt-account-id"] ?? extractAccountId(token),
	};
}

export function codexToolProviderEnv(provider: CodexToolProvider): NodeJS.ProcessEnv {
	return {
		...process.env,
		PI_CODEX_ACCESS_TOKEN: provider.token,
		PI_CODEX_ACCOUNT_ID: provider.accountId,
		PI_CODEX_BASE_URL: provider.baseUrl,
		PI_CODEX_ALPHA_SEARCH_URL: resolveCodexAlphaSearchUrl(provider.baseUrl),
		...(provider.model ? { PI_CODEX_MODEL: provider.model } : {}),
	};
}

