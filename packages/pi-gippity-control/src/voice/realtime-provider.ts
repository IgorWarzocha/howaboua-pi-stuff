import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeVoiceApiProvider } from "../config.ts";

/** Resolve one user-selected account and route before any Realtime request. */
export async function resolveRealtimeProvider(
	ctx: ExtensionContext,
	name: string,
): Promise<{
	headers: Headers;
	baseUrl: string;
	env?: Record<string, string>;
}> {
	if (!normalizeVoiceApiProvider(name))
		throw new Error(
			"Enter a nonempty API provider name in voice settings (at most 512 bytes, no surrounding whitespace or control characters).",
		);
	const registry = ctx.modelRegistry;
	const provider = registry.getProvider(name);
	const authError =
		"Realtime requires an API key for the exact API provider name in voice settings. Configure that provider in Pi, or change the name. ChatGPT and OAuth logins cannot be used.";
	let auth;
	try {
		auth = await registry.getProviderAuth(name);
	} catch {
		throw new Error(authError);
	}
	if (
		!provider ||
		!auth?.auth.apiKey?.trim() ||
		auth.source?.toLowerCase() === "oauth"
	)
		throw new Error(authError);
	const routeError =
		"Realtime requires a valid HTTP or HTTPS base URL for the selected API provider. Configure its endpoint in Pi without URL credentials, query or fragment, then start again.";
	// Pi's resolved auth endpoint overrides the provider endpoint. Chat model
	// overrides do not apply: voice selects a provider, not a chat model.
	const route = auth.auth.baseUrl ?? provider.baseUrl;
	let url: URL;
	try {
		if (typeof route !== "string") throw new Error(routeError);
		url = new URL(route);
	} catch {
		throw new Error(routeError);
	}
	if (
		!/^https?:\/\//i.test(route) ||
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		/[\s\\?#]/u.test(route)
	)
		throw new Error(routeError);
	const baseUrl = url.href.replace(/\/+$/, "");
	const headerError =
		"Realtime could not use the selected provider's API headers. Configure valid headers matching its API key in Pi, then start again.";
	const key = auth.auth.apiKey;
	const makeHeaders = (values: typeof auth.auth.headers) => {
		const headers = new Headers();
		try {
			for (const entries of [provider.headers, values]) {
				const seen = new Map<string, string | null>();
				for (const [name, value] of Object.entries(entries ?? {})) {
					if (value !== null && typeof value !== "string")
						throw new Error(headerError);
					const normal = value?.trim() ?? null;
					const lower = name.toLowerCase();
					if (seen.has(lower) && seen.get(lower) !== normal)
						throw new Error(headerError);
					seen.set(lower, normal);
					if (value === null) headers.delete(name);
					else headers.set(name, value);
				}
			}
			const authorization = headers.get("authorization");
			if (authorization !== null && authorization !== `Bearer ${key}`)
				throw new Error(headerError);
			headers.set("authorization", `Bearer ${key}`);
		} catch {
			throw new Error(headerError);
		}
		return headers;
	};
	const headers = makeHeaders(auth.auth.headers);
	return { headers, baseUrl, ...(auth.env ? { env: auth.env } : {}) };
}
