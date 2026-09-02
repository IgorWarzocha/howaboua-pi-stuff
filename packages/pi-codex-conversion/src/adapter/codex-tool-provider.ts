import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_BASE_URL } from "../providers/openai-codex/constants.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";
import {
	isCodexTransportModel,
	isOpenAICodexModel,
} from "./prompt/codex-model.ts";

const CONFIGURED_PROVIDER_CHANNEL =
	"@howaboua/pi-codex-conversion.configured-provider/v1";
const PROVIDER_RESOLVER_CHANNEL =
	"@howaboua/pi-codex-conversion.provider-resolver/v1";
const CODEX_TOOL_ORIGINATOR = "codex_cli_rs";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const PREFERRED_MODELS = [
	"gpt-5.6-luna",
	"gpt-5.6-terra",
	"gpt-5.6-sol",
	"gpt-5.5",
	"gpt-5.4-mini",
	"gpt-5.3-codex-spark",
];

export const CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE =
	"Codex-backed tool requires an OpenAI Codex-compatible Responses provider or /login openai-codex";

export interface CodexToolProvider {
	route: "openai-codex" | "configured-responses";
	baseUrl: string;
	responsesUrl: string;
	searchUrl: string;
	model: string | undefined;
	token: string;
	accountId: string;
}

export type AllowConfiguredCodexToolProvider = (
	model: ExtensionContext["model"],
) => boolean;
export type CodexToolProviderResolver = (
	ctx: ExtensionContext,
) => Promise<CodexToolProvider>;

interface ConfiguredProviderRequest {
	model: ExtensionContext["model"];
	allow(): void;
}

interface ProviderResolverRequest {
	use(resolver: CodexToolProviderResolver): void;
}

export function registerCodexToolProviderPolicy(
	pi: ExtensionAPI,
	allows: (model: ExtensionContext["model"]) => boolean,
): () => void {
	return pi.events.on(CONFIGURED_PROVIDER_CHANNEL, (value) => {
		if (!isConfiguredProviderRequest(value)) return;
		if (allows(value.model)) value.allow();
	});
}

export function registerCodexToolProviderResolver(
	pi: ExtensionAPI,
	resolver: CodexToolProviderResolver,
): () => void {
	return pi.events.on(PROVIDER_RESOLVER_CHANNEL, (value) => {
		if (isProviderResolverRequest(value)) value.use(resolver);
	});
}

export function resolveCodexApiProviderBaseUrl(
	modelBaseUrl: string | undefined,
): string {
	const base = modelBaseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
	const normalized = base.replace(/\/+$/, "");
	try {
		const url = new URL(normalized);
		if (url.pathname === "" || url.pathname === "/")
			return `${normalized}/api/codex`;
	} catch {
		// Keep string-only fallback below.
	}
	if (normalized.endsWith("/codex/responses"))
		return normalized.slice(0, -"/responses".length);
	if (normalized.endsWith("/codex")) return normalized;
	if (normalized.endsWith("/backend-api") || normalized.endsWith("/api"))
		return `${normalized}/codex`;
	return normalized;
}

export function resolveCodexResponsesUrl(providerBaseUrl: string): string {
	const base = providerBaseUrl.replace(/\/+$/, "");
	if (base.endsWith("/codex/responses")) return base;
	return `${resolveCodexApiProviderBaseUrl(base)}/responses`;
}

export function resolveCodexSearchUrl(providerBaseUrl: string): string {
	const normalized = providerBaseUrl.trim().replace(/\/+$/, "");
	if (normalized.endsWith("/alpha/search")) return normalized;
	const base = normalized.endsWith("/responses")
		? normalized.slice(0, -"/responses".length)
		: resolveCodexApiProviderBaseUrl(normalized);
	return `${base}/alpha/search`;
}

export async function resolveCodexToolProvider(
	ctx: ExtensionContext,
	allowConfiguredProvider?: AllowConfiguredCodexToolProvider,
): Promise<CodexToolProvider> {
	const model = resolveAuthModel(ctx, allowConfiguredProvider);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	const resolvedBaseUrl = auth.baseUrl ?? model.baseUrl;
	const codexTransport = isCodexTransportModel(model);
	const authorization = headerValue(auth.headers, "Authorization")
		?.match(/^Bearer\s+(.+)$/i)?.[1]
		?.trim();
	const token = codexTransport
		? (auth.apiKey ?? authorization)
		: (authorization ?? auth.apiKey);
	if (!token) throw new Error(CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE);
	const baseUrl = codexTransport
		? resolveCodexApiProviderBaseUrl(resolvedBaseUrl)
		: resolvedBaseUrl?.trim().replace(/\/+$/, "");
	if (!baseUrl)
		throw new Error("Configured Responses provider is missing a base URL");
	const responsesUrl = codexTransport
		? resolveCodexResponsesUrl(baseUrl)
		: resolveConfiguredResponsesUrl(baseUrl);
	return {
		route: codexTransport ? "openai-codex" : "configured-responses",
		baseUrl,
		responsesUrl,
		searchUrl: resolveCodexSearchUrl(responsesUrl),
		model: model.id,
		token,
		accountId:
			headerValue(auth.headers, "chatgpt-account-id") ??
			(codexTransport ? extractAccountId(token) : ""),
	};
}

export function codexToolProviderHeaders(provider: CodexToolProvider): Headers {
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${provider.token}`);
	headers.set("ChatGPT-Account-ID", provider.accountId);
	headers.set("originator", CODEX_TOOL_ORIGINATOR);
	headers.set("User-Agent", codexWebRunUserAgent());
	headers.set("version", "0.0.0");
	headers.set("content-type", "application/json");
	return headers;
}

function isConfiguredProviderRequest(
	value: unknown,
): value is ConfiguredProviderRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"model" in value &&
			"allow" in value &&
			typeof value.allow === "function",
	);
}

function isProviderResolverRequest(
	value: unknown,
): value is ProviderResolverRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"use" in value &&
			typeof value.use === "function",
	);
}

function isResponsesModel(model: ExtensionContext["model"]): boolean {
	return Boolean(model?.api?.includes("responses"));
}

function isUsableOpenAICodexModel(
	model: ExtensionContext["model"],
): model is Model<Api> {
	return isOpenAICodexModel(model) && isResponsesModel(model);
}

function resolveOpenAICodexAuthModel(
	ctx: ExtensionContext,
): Model<Api> | undefined {
	const registry = ctx.modelRegistry as {
		find?: (provider: string, modelId: string) => Model<Api> | undefined;
		getAvailable?: () => Model<Api>[];
		getAll?: () => Model<Api>[];
	};
	const currentId = ctx.model?.id;
	const direct = currentId
		? registry.find?.(OPENAI_CODEX_PROVIDER, currentId)
		: undefined;
	if (isUsableOpenAICodexModel(direct)) return direct;
	const preferred = PREFERRED_MODELS.map((id) =>
		registry.find?.(OPENAI_CODEX_PROVIDER, id),
	).find(isUsableOpenAICodexModel);
	if (preferred) return preferred;
	return (
		registry.getAvailable?.().find(isUsableOpenAICodexModel) ??
		registry.getAll?.().find(isUsableOpenAICodexModel)
	);
}

function resolveAuthModel(
	ctx: ExtensionContext,
	allowConfiguredProvider?: AllowConfiguredCodexToolProvider,
): Model<Api> {
	if (isCodexTransportModel(ctx.model) && isResponsesModel(ctx.model))
		return ctx.model as Model<Api>;
	if (isResponsesModel(ctx.model) && allowConfiguredProvider?.(ctx.model))
		return ctx.model as Model<Api>;
	const fallback = resolveOpenAICodexAuthModel(ctx);
	if (fallback) return fallback;
	throw new Error(
		CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE +
			"; run /login openai-codex or select an OpenAI Codex-compatible provider",
	);
}

function resolveConfiguredResponsesUrl(
	modelBaseUrl: string | undefined,
): string {
	const base = modelBaseUrl?.trim().replace(/\/+$/, "");
	if (!base)
		throw new Error("Configured Responses provider is missing a base URL");
	return base.endsWith("/responses") ? base : `${base}/responses`;
}

function headerValue(
	headers: ProviderHeaders | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const lowerName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName)
			return typeof value === "string" ? value : undefined;
	}
	return undefined;
}

function codexWebRunUserAgent(): string {
	const platform =
		process.platform === "darwin"
			? "Mac OS"
			: process.platform === "win32"
				? "Windows"
				: process.platform === "linux"
					? "Linux"
					: process.platform;
	const arch = process.arch === "arm64" ? "arm64" : process.arch;
	const { TERM_PROGRAM, TERM } = process.env;
	const terminal = TERM_PROGRAM?.trim() || TERM?.trim() || "unknown";
	return (
		CODEX_TOOL_ORIGINATOR +
		"/0.0.0 (" +
		platform +
		" unknown; " +
		arch +
		") " +
		terminal
	);
}
