import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export async function getSitesAuth(ctx: ExtensionContext) {
	const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
	const message =
		"Sites requires an OpenAI Codex login. Ask the user to run /login openai-codex (legacy OpenAI Codex)";
	if (!token) throw new Error(message);
	try {
		const part = token.split(".")[1];
		if (!part) throw new Error(message);
		const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
		const accountId: unknown =
			claims["https://api.openai.com/auth"]?.chatgpt_account_id;
		if (typeof accountId !== "string" || !accountId) throw new Error(message);
		return { token, accountId };
	} catch {
		throw new Error(message);
	}
}
