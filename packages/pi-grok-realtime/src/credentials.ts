import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GrokRealtimeConfig } from "./config.ts";

/** Pi exposes only its active credential; never resolve/refresh auth when saving. */
export function validateAccess(
	ctx: ExtensionContext,
	access: GrokRealtimeConfig["access"],
): void {
	const registry = ctx.modelRegistry;
	const model = registry.getAll().find((model) => model.provider === "xai");
	const status = registry.getProviderAuthStatus("xai");
	if (!status.configured || !model)
		throw new Error(
			"No Pi xAI credential is available. Configure xAI in Pi before selecting access",
		);
	const active = registry.isUsingOAuth(model) ? "oauth" : "api_key";
	if (active !== access)
		throw new Error(
			`Selected ${access === "oauth" ? "OAuth" : "API key"} is unavailable: Pi's active xAI credential is ${active === "oauth" ? "OAuth" : "an API key"}. Configure the matching credential in Pi; settings were not changed`,
		);
}

/** Fresh Pi xAI transport bearer, including Grok/X OAuth. Never persist it. */
export async function resolveBearer(
	ctx: ExtensionContext,
	access: GrokRealtimeConfig["access"],
	signal: AbortSignal,
): Promise<string> {
	if (signal.aborted) throw new Error("Voice startup cancelled");
	validateAccess(ctx, access);
	const resolved = await new Promise<
		Awaited<ReturnType<typeof ctx.modelRegistry.getProviderAuth>>
	>((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(new Error("Voice startup cancelled"));
		};
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve()
			.then(() => ctx.modelRegistry.getProviderAuth("xai"))
			.then(resolve, reject)
			.finally(() => {
				signal.removeEventListener("abort", abort);
			});
	});
	if (signal.aborted) throw new Error("Voice startup cancelled");
	validateAccess(ctx, access);
	if (!resolved?.auth.apiKey)
		throw new Error(
			"No Pi xAI login is configured. Use /login xai before starting Grok voice",
		);
	// Pi's canonical OAuth resolver labels its result; the bearer alone has no login type.
	if ((resolved.source === "OAuth") !== (access === "oauth"))
		throw new Error(
			"Pi xAI resolved a different credential type than selected. Configure the matching credential in Pi before starting",
		);
	return resolved.auth.apiKey;
}

/** Reuse Pi's xAI login, including Grok/X OAuth. Never persist credentials. */
export async function resolveConnection(
	ctx: ExtensionContext,
	model: string,
	access: GrokRealtimeConfig["access"],
	signal: AbortSignal,
): Promise<{
	url: string;
	protocols: string[];
	headers: Record<string, string>;
}> {
	const bearer = await resolveBearer(ctx, access, signal);
	return {
		url: `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`,
		protocols: [],
		headers: { Authorization: `Bearer ${bearer}` },
	};
}
