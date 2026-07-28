import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface CodexVoiceAuth {
	headers: Headers;
	baseUrl: string;
	officialCodex: boolean;
	env?: Record<string, string>;
}

export async function resolveCodexVoiceAuth(
	ctx: ExtensionContext,
): Promise<CodexVoiceAuth> {
	const resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
	const token = resolved?.auth.apiKey;
	if (!token)
		throw new Error("OpenAI Codex login is required before starting voice");
	const headers = new Headers();
	for (const [name, value] of Object.entries(resolved.auth.headers ?? {}))
		if (value !== null) headers.set(name, value);
	headers.set("authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", extractAccountId(token));
	headers.set("originator", "pi");
	headers.set("x-session-id", ctx.sessionManager.getSessionId());
	headers.set("user-agent", "pi-gippity-control");
	const baseUrl =
		resolved.auth.baseUrl ?? "https://chatgpt.com/backend-api/codex";
	return {
		headers,
		baseUrl,
		officialCodex: isOfficialCodexBaseUrl(baseUrl),
		...(resolved.env ? { env: resolved.env } : {}),
	};
}

function extractAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error();
		const payload = JSON.parse(
			Buffer.from(parts[1] ?? "", "base64").toString("utf8"),
		) as Record<string, unknown>;
		const auth = payload["https://api.openai.com/auth"];
		if (!auth || typeof auth !== "object") throw new Error();
		const accountId = (auth as Record<string, unknown>)["chatgpt_account_id"];
		if (typeof accountId !== "string" || !accountId) throw new Error();
		return accountId;
	} catch {
		throw new Error(
			"Failed to read the ChatGPT account from the OpenAI Codex login",
		);
	}
}

function isOfficialCodexBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			url.hostname === "chatgpt.com" &&
			/^\/backend-api\/codex\/?$/.test(url.pathname)
		);
	} catch {
		return false;
	}
}
