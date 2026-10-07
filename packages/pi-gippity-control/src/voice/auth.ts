import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface CodexVoiceAuth {
	headers: Headers;
	baseUrl: string;
	officialCodex: boolean;
	loginFailure?(): Error;
	env?: Record<string, string>;
}

export async function resolveCodexVoiceAuth(
	ctx: ExtensionContext,
): Promise<CodexVoiceAuth> {
	let resolved;
	try {
		resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "oauth")
			throw voiceLoginFailure(ctx);
		throw error;
	}
	const token = resolved?.auth.apiKey;
	if (!resolved || !token) throw voiceLoginFailure(ctx);
	const headers = new Headers();
	for (const [name, value] of Object.entries(resolved.auth.headers ?? {}))
		if (value !== null) headers.set(name, value);
	headers.set("authorization", `Bearer ${token}`);
	try {
		headers.set("chatgpt-account-id", extractAccountId(token));
	} catch {
		throw voiceLoginFailure(ctx);
	}
	headers.set("originator", "pi");
	headers.set("x-session-id", ctx.sessionManager.getSessionId());
	headers.set("user-agent", "pi-gippity-control");
	const baseUrl =
		resolved.auth.baseUrl ?? "https://chatgpt.com/backend-api/codex";
	return {
		headers,
		baseUrl,
		officialCodex: isOfficialCodexBaseUrl(baseUrl),
		loginFailure: () => voiceLoginFailure(ctx),
		...(resolved.env ? { env: resolved.env } : {}),
	};
}

function voiceLoginFailure(ctx: ExtensionContext): Error {
	const legacy = ctx.modelRegistry.getProviderAuthStatus("openai-codex");
	if (legacy.configured)
		return new Error(
			"Voice could not use the OpenAI Codex login. Renew it with /login openai-codex (legacy OpenAI Codex).",
		);
	const openai = ctx.modelRegistry
		.getAll()
		.find((model) => model.provider === "openai");
	const signin = openai && ctx.modelRegistry.isUsingOAuth(openai);
	return new Error(
		signin
			? "Voice requires the legacy OpenAI Codex login, not Sign in with ChatGPT. Run /login openai-codex."
			: "Voice requires an OpenAI Codex login. Run /login openai-codex (legacy OpenAI Codex).",
	);
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
