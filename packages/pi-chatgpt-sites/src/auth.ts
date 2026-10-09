import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export async function getSitesAuth(ctx: ExtensionContext) {
	const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
	const message =
		"Sites requires an OpenAI Codex login. Ask the user to run /login openai-codex (legacy OpenAI Codex)";
	if (!token) throw new Error(message);
	try {
		const part = token.split(".")[1];
		if (!part) throw new Error(message);
		const claims: unknown = JSON.parse(
			Buffer.from(part, "base64url").toString("utf8"),
		);
		const identity = isRecord(claims)
			? claims["https://api.openai.com/auth"]
			: undefined;
		const accountId = isRecord(identity)
			? identity["chatgpt_account_id"]
			: undefined;
		if (typeof accountId !== "string" || !accountId) throw new Error(message);
		return { token, accountId };
	} catch {
		throw new Error(message);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
