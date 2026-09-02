import { DEFAULT_CODEX_BASE_URL } from "./types.js";

export function resolveCodexApiProviderBaseUrl(
	modelBaseUrl: string | undefined,
): string {
	const base = modelBaseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
	const normalized = base.replace(/\/+$/, "");
	try {
		const url = new URL(normalized);
		if (url.pathname === "" || url.pathname === "/")
			return normalized + "/api/codex";
	} catch {
		// Keep string-only fallback below.
	}
	if (normalized.endsWith("/codex/responses"))
		return normalized.slice(0, -"/responses".length);
	if (normalized.endsWith("/codex")) return normalized;
	if (normalized.endsWith("/backend-api") || normalized.endsWith("/api"))
		return normalized + "/codex";
	return normalized;
}

export function resolveCodexResponsesUrl(providerBaseUrl: string): string {
	const base = providerBaseUrl.replace(/\/+$/, "");
	if (base.endsWith("/codex/responses")) return base;
	return resolveCodexApiProviderBaseUrl(base) + "/responses";
}

export function resolveCodexSearchUrl(providerBaseUrl: string): string {
	const normalized = providerBaseUrl.trim().replace(/\/+$/, "");
	if (normalized.endsWith("/alpha/search")) return normalized;
	const base = normalized.endsWith("/responses")
		? normalized.slice(0, -"/responses".length)
		: resolveCodexApiProviderBaseUrl(normalized);
	return base + "/alpha/search";
}
