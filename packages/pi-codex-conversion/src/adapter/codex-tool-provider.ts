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

const CODEX_ORIGINATOR = "codex_cli_rs";

export function resolveCodexApiProviderBaseUrl(modelBaseUrl: string | undefined): string {
	const base = modelBaseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
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

export function resolveCodexResponsesUrl(providerBaseUrl: string): string {
	const base = providerBaseUrl.replace(/\/+$/, "");
	if (base.endsWith("/codex/responses")) return base;
	return `${resolveCodexApiProviderBaseUrl(base)}/responses`;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const lowerName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName) return value;
	}
	return undefined;
}

export async function resolveCodexToolProvider(ctx: ExtensionContext): Promise<CodexToolProvider> {
	if (!ctx.model) throw new Error(CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);
	const token = auth.apiKey ?? headerValue(auth.headers, "Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) throw new Error(CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE);
	return {
		baseUrl: resolveCodexApiProviderBaseUrl(ctx.model.baseUrl),
		model: ctx.model.id,
		token,
		accountId: headerValue(auth.headers, "chatgpt-account-id") ?? extractAccountId(token),
	};
}

export function codexToolProviderHeaders(provider: CodexToolProvider): Headers {
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${provider.token}`);
	headers.set("ChatGPT-Account-ID", provider.accountId);
	headers.set("originator", CODEX_ORIGINATOR);
	headers.set("User-Agent", codexWebRunUserAgent(CODEX_ORIGINATOR));
	headers.set("version", "0.0.0");
	headers.set("content-type", "application/json");
	return headers;
}

export function codexWebRunUserAgent(originator: string = CODEX_ORIGINATOR): string {
	const platform = process.platform === "darwin" ? "Mac OS" : process.platform === "win32" ? "Windows" : process.platform === "linux" ? "Linux" : process.platform;
	const release = "unknown";
	const arch = process.arch === "arm64" ? "arm64" : process.arch;
	const terminal = process.env["TERM_PROGRAM"]?.trim() || process.env["TERM"]?.trim() || "unknown";
	return `${originator}/0.0.0 (${platform} ${release}; ${arch}) ${terminal}`;
}

export function codexToolProviderEnv(provider: CodexToolProvider): NodeJS.ProcessEnv {
	return {
		...process.env,
		PI_CODEX_ACCESS_TOKEN: provider.token,
		PI_CODEX_ACCOUNT_ID: provider.accountId,
		PI_CODEX_BASE_URL: provider.baseUrl,
		PI_CODEX_RESPONSES_URL: resolveCodexResponsesUrl(provider.baseUrl),
		...(provider.model ? { PI_CODEX_MODEL: provider.model } : {}),
	};
}
