import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractAccountId } from "../providers/openai-codex/headers.ts";

export interface CodexVoiceAuth {
	headers: Headers;
	baseUrl: string;
	officialCodex: boolean;
	env?: Record<string, string>;
}

export async function resolveCodexVoiceAuth(ctx: ExtensionContext): Promise<CodexVoiceAuth> {
	const resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
	const token = resolved?.auth.apiKey;
	if (!token) throw new Error("OpenAI Codex login is required before starting voice");
	const headers = new Headers();
	for (const [name, value] of Object.entries(resolved.auth.headers ?? {})) if (value !== null) headers.set(name, value);
	headers.set("authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", extractAccountId(token));
	headers.set("originator", "pi");
	headers.set("x-session-id", ctx.sessionManager.getSessionId());
	headers.set("user-agent", "pi-codex-conversion");
	const baseUrl = resolved.auth.baseUrl ?? "https://chatgpt.com/backend-api/codex";
	return {
		headers,
		baseUrl,
		officialCodex: isOfficialCodexBaseUrl(baseUrl),
		...(resolved.env ? { env: resolved.env } : {}),
	};
}

function isOfficialCodexBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "chatgpt.com" && /^\/backend-api\/codex\/?$/.test(url.pathname);
	} catch {
		return false;
	}
}
