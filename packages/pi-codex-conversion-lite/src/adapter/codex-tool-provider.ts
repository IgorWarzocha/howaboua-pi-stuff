import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { DEFAULT_CODEX_BASE_URL } from "../providers/openai-codex/constants.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";

export const CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE = "web_run/imagegen requires an OpenAI Codex-compatible Responses provider or /login openai-codex";

export interface CodexToolProvider {
	route: "openai-codex" | "configured-responses";
	baseUrl: string;
	responsesUrl: string;
	model: string | undefined;
	token: string;
	accountId: string;
}

export type AllowConfiguredCodexToolProvider = (model: ExtensionContext["model"]) => boolean;

const CODEX_ORIGINATOR = "codex_cli_rs";
const OPENAI_CODEX_PROVIDER = "openai-codex";

export function resolveCodexApiProviderBaseUrl(modelBaseUrl: string | undefined): string {
	const base = modelBaseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
	const normalized = base.replace(/\/+$/, "");
	try {
		const url = new URL(normalized);
		if (url.pathname === "" || url.pathname === "/") return `${normalized}/api/codex`;
	} catch {
		// Keep string-only fallback below.
	}
	if (normalized.endsWith("/codex/responses")) return normalized.slice(0, -"/responses".length);
	if (normalized.endsWith("/codex")) return normalized;
	if (normalized.endsWith("/backend-api") || normalized.endsWith("/api")) return `${normalized}/codex`;
	return normalized;
}

export function resolveCodexResponsesUrl(providerBaseUrl: string): string {
	const base = providerBaseUrl.replace(/\/+$/, "");
	if (base.endsWith("/codex/responses")) return base;
	return `${resolveCodexApiProviderBaseUrl(base)}/responses`;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const lowerName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName) return value;
	}
	return undefined;
}

function isOpenAICodexModel(model: ExtensionContext["model"]): boolean {
	return (model?.provider ?? "").trim().toLowerCase() === OPENAI_CODEX_PROVIDER;
}

function isResponsesModel(model: ExtensionContext["model"]): boolean {
	return Boolean(model?.api?.includes("responses"));
}

function isUsableOpenAICodexModel(model: ExtensionContext["model"]): boolean {
	return isOpenAICodexModel(model) && isResponsesModel(model);
}

function firstOpenAICodexModel(models: Model<any>[]): Model<any> | undefined {
	return models.find(isUsableOpenAICodexModel);
}

function resolveOpenAICodexAuthModel(ctx: ExtensionContext): Model<any> | undefined {
	const registry = ctx.modelRegistry as {
		find?: (provider: string, modelId: string) => Model<any> | undefined;
		getAvailable?: () => Model<any>[];
		getAll?: () => Model<any>[];
	};
	const currentId = ctx.model?.id;
	const direct = currentId ? registry.find?.(OPENAI_CODEX_PROVIDER, currentId) : undefined;
	if (isUsableOpenAICodexModel(direct)) return direct;
	const preferred = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex-spark"]
		.map((id) => registry.find?.(OPENAI_CODEX_PROVIDER, id))
		.find((model): model is Model<any> => isUsableOpenAICodexModel(model));
	if (preferred) return preferred;
	const available = registry.getAvailable?.();
	if (available) return firstOpenAICodexModel(available);
	const all = registry.getAll?.();
	return all ? firstOpenAICodexModel(all) : undefined;
}

function resolveCodexToolAuthModel(ctx: ExtensionContext, allowConfiguredProvider?: AllowConfiguredCodexToolProvider): Model<any> {
	if (isUsableOpenAICodexModel(ctx.model)) return ctx.model as Model<any>;
	if (isResponsesModel(ctx.model) && allowConfiguredProvider?.(ctx.model)) return ctx.model as Model<any>;
	const openAICodexModel = resolveOpenAICodexAuthModel(ctx);
	if (openAICodexModel) return openAICodexModel;
	throw new Error(`${CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE}; run /login openai-codex or select an OpenAI Codex-compatible provider`);
}

function resolveConfiguredResponsesUrl(modelBaseUrl: string | undefined): string {
	const base = modelBaseUrl?.trim().replace(/\/+$/, "");
	if (!base) throw new Error("Configured Responses provider is missing a base URL");
	return base.endsWith("/responses") ? base : `${base}/responses`;
}

export async function resolveCodexToolProvider(ctx: ExtensionContext, allowConfiguredProvider?: AllowConfiguredCodexToolProvider): Promise<CodexToolProvider> {
	const model = resolveCodexToolAuthModel(ctx, allowConfiguredProvider);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	const openAICodex = isOpenAICodexModel(model);
	const authorization = headerValue(auth.headers, "Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
	const token = openAICodex ? auth.apiKey ?? authorization : authorization ?? auth.apiKey;
	if (!token) throw new Error(CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE);
	const baseUrl = openAICodex
		? resolveCodexApiProviderBaseUrl(model.baseUrl)
		: model.baseUrl?.trim().replace(/\/+$/, "");
	if (!baseUrl) throw new Error("Configured Responses provider is missing a base URL");
	return {
		route: openAICodex ? "openai-codex" : "configured-responses",
		baseUrl,
		responsesUrl: openAICodex ? resolveCodexResponsesUrl(baseUrl) : resolveConfiguredResponsesUrl(baseUrl),
		model: model.id,
		token,
		accountId: headerValue(auth.headers, "chatgpt-account-id") ?? (openAICodex ? extractAccountId(token) : ""),
	};
}

export function codexToolProviderHeaders(provider: CodexToolProvider): Headers {
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${provider.token}`);
	headers.set("ChatGPT-Account-ID", provider.accountId);
	headers.set("originator", CODEX_ORIGINATOR);
	headers.set("User-Agent", codexWebRunUserAgent(CODEX_ORIGINATOR));
	headers.set("version", "0.0.0");
	headers.set("content-type", "application/json");
	return headers;
}

export function codexWebRunUserAgent(originator: string = CODEX_ORIGINATOR): string {
	const platform = process.platform === "darwin" ? "Mac OS" : process.platform === "win32" ? "Windows" : process.platform === "linux" ? "Linux" : process.platform;
	const release = "unknown";
	const arch = process.arch === "arm64" ? "arm64" : process.arch;
	const terminal = process.env["TERM_PROGRAM"]?.trim() || process.env["TERM"]?.trim() || "unknown";
	return `${originator}/0.0.0 (${platform} ${release}; ${arch}) ${terminal}`;
}

export function codexToolProviderEnv(provider: CodexToolProvider): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_CODEX_ACCESS_TOKEN: provider.token,
		PI_CODEX_ACCOUNT_ID: provider.accountId,
		PI_CODEX_BASE_URL: provider.baseUrl,
		PI_CODEX_RESPONSES_URL: provider.responsesUrl,
		...(provider.model ? { PI_CODEX_MODEL: provider.model } : {}),
	};
	if (provider.route === "configured-responses") delete env["PI_CODEX_AGENT_IDENTITY_JWT"];
	return env;
}
