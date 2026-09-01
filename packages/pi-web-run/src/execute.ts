import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	codexToolProviderHeaders,
	fetchCodexTool,
	resolveCodexToolProvider,
} from "@howaboua/pi-codex-tool-runtime";
import {
	DEFAULT_WEB_SEARCH_MODEL,
	WEB_SEARCH_MAX_RESPONSE_BYTES,
	type WebRunOutput,
	type WebSearchToolOptions,
} from "./contract.js";
import { buildWebSearchRequest, normalizeSearchResponse } from "./request.js";

export interface WebRunExecutionResult {
	text: string;
	details: WebRunOutput;
}

function supportsNativeWebSearch(model: ExtensionContext["model"]): boolean {
	const api = (model?.api ?? "").trim().toLowerCase();
	return (
		api.includes("responses") &&
		((model?.provider ?? "").trim().toLowerCase() === "openai-codex" ||
			api === "openai-codex-responses")
	);
}

export function supportsExecutableWebSearch(
	model: ExtensionContext["model"],
	options: WebSearchToolOptions,
): boolean {
	return (
		supportsNativeWebSearch(model) ||
		Boolean(options.allowConfiguredProvider?.(model)) ||
		options.allowCodexProviderFallback === true
	);
}

function configuredModel(options: WebSearchToolOptions): string | undefined {
	const value =
		typeof options.model === "function" ? options.model() : options.model;
	return value ?? (process.env["PI_CODEX_MODEL"]?.trim() || undefined);
}

export async function executeCodexWebSearch(
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined | null,
	options: WebSearchToolOptions = {},
): Promise<WebRunExecutionResult> {
	const provider = await resolveCodexToolProvider(
		ctx,
		options.allowConfiguredProvider,
	);
	const body = buildWebSearchRequest(params, {
		id:
			ctx.sessionManager?.getSessionId?.() || options.sessionId || randomUUID(),
		model:
			provider.route === "configured-responses"
				? (provider.model ?? DEFAULT_WEB_SEARCH_MODEL)
				: (configuredModel(options) ?? DEFAULT_WEB_SEARCH_MODEL),
	});
	const response = await fetchCodexTool(provider.searchUrl, {
		method: "POST",
		headers: codexToolProviderHeaders(provider),
		body: JSON.stringify(body),
		...(signal ? { signal } : {}),
		maxResponseBytes: WEB_SEARCH_MAX_RESPONSE_BYTES,
	});
	const cloudflareChallenge =
		response.headers.get("cf-mitigated")?.toLowerCase() === "challenge" ||
		(response.headers.get("server")?.toLowerCase() === "cloudflare" &&
			response.text.trimStart().startsWith("<html"));
	if (response.status < 200 || response.status >= 300) {
		if (
			response.status === 403 &&
			(cloudflareChallenge ||
				response.text.toLowerCase().includes("cloudflare"))
		)
			throw new Error(
				"web_run search failed for " +
					provider.searchUrl +
					": HTTP 403 Cloudflare challenge",
			);
		if (response.status === 404 && response.text.includes('"Not Found"'))
			throw new Error(
				"web_run search failed for " +
					provider.searchUrl +
					": HTTP 404 Not Found (Codex endpoint unavailable for this account/backend)",
			);
		throw new Error(
			"web_run search failed for " +
				provider.searchUrl +
				": HTTP " +
				response.status +
				" " +
				response.text,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.text);
	} catch {
		throw new Error("failed to decode web_run search response");
	}
	const details = normalizeSearchResponse(parsed);
	const text =
		typeof details.output_text === "string" && details.output_text.trim()
			? details.output_text
			: JSON.stringify(details, null, 2);
	return { text, details };
}
