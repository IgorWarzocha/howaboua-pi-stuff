import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeVoiceApiProvider } from "../config.ts";

/** Resolve one user-selected account and route before any API voice request. */
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
			"Voice settings need an API provider name: 1 to 512 bytes, no surrounding whitespace or control characters.",
		);
	const registry = ctx.modelRegistry;
	const provider = registry.getProvider(name);
	const authError =
		"API voice needs an API key, not a ChatGPT or other OAuth login. Configure the selected provider in Pi or choose another in voice settings.";
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
		"API voice needs an HTTP or HTTPS base URL without credentials, query or fragment. Set it for the selected provider in Pi, then restart voice.";
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
		"Invalid API headers for the selected provider. Fix headers to match its API key in Pi, then restart voice.";
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
