import { DEFAULT_CODEX_BASE_URL } from "../providers/openai-codex/constants.js";
import { extractAccountId } from "../providers/openai-codex/headers.js";
export const CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE = "web_run/imagegen requires an OpenAI Codex-compatible Responses provider or /login openai-codex";
const CODEX_ORIGINATOR = "codex_cli_rs";
const OPENAI_CODEX_PROVIDER = "openai-codex";
export function resolveCodexApiProviderBaseUrl(modelBaseUrl) {
    const base = modelBaseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
    const normalized = base.replace(/\/+$/, "");
    try {
        const url = new URL(normalized);
        if (url.pathname === "" || url.pathname === "/")
            return `${normalized}/api/codex`;
    }
    catch {
        // Keep string-only fallback below.
    }
    if (normalized.endsWith("/codex/responses"))
        return normalized.slice(0, -"/responses".length);
    if (normalized.endsWith("/codex"))
        return normalized;
    if (normalized.endsWith("/backend-api") || normalized.endsWith("/api"))
        return `${normalized}/codex`;
    return normalized;
}
export function resolveCodexResponsesUrl(providerBaseUrl) {
    const base = providerBaseUrl.replace(/\/+$/, "");
    if (base.endsWith("/codex/responses"))
        return base;
    return `${resolveCodexApiProviderBaseUrl(base)}/responses`;
}
function headerValue(headers, name) {
    if (!headers)
        return undefined;
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerName)
            return value;
    }
    return undefined;
}
function isOpenAICodexModel(model) {
    return (model?.provider ?? "").trim().toLowerCase() === OPENAI_CODEX_PROVIDER;
}
function isResponsesModel(model) {
    return Boolean(model?.api?.includes("responses"));
}
function isUsableOpenAICodexModel(model) {
    return isOpenAICodexModel(model) && isResponsesModel(model);
}
function firstOpenAICodexModel(models) {
    return models.find(isUsableOpenAICodexModel);
}
function resolveOpenAICodexAuthModel(ctx) {
    const registry = ctx.modelRegistry;
    const currentId = ctx.model?.id;
    const direct = currentId ? registry.find?.(OPENAI_CODEX_PROVIDER, currentId) : undefined;
    if (isUsableOpenAICodexModel(direct))
        return direct;
    const preferred = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex-spark"]
        .map((id) => registry.find?.(OPENAI_CODEX_PROVIDER, id))
        .find((model) => isUsableOpenAICodexModel(model));
    if (preferred)
        return preferred;
    const available = registry.getAvailable?.();
    if (available)
        return firstOpenAICodexModel(available);
    const all = registry.getAll?.();
    return all ? firstOpenAICodexModel(all) : undefined;
}
function resolveCodexToolAuthModel(ctx) {
    if (isUsableOpenAICodexModel(ctx.model))
        return ctx.model;
    const openAICodexModel = resolveOpenAICodexAuthModel(ctx);
    if (openAICodexModel)
        return openAICodexModel;
    throw new Error(`${CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE}; run /login openai-codex or select an OpenAI Codex-compatible provider`);
}
export async function resolveCodexToolProvider(ctx) {
    const model = resolveCodexToolAuthModel(ctx);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok)
        throw new Error(auth.error);
    const token = auth.apiKey ?? headerValue(auth.headers, "Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token)
        throw new Error(CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE);
    return {
        baseUrl: resolveCodexApiProviderBaseUrl(model.baseUrl),
        model: model.id,
        token,
        accountId: headerValue(auth.headers, "chatgpt-account-id") ?? extractAccountId(token),
    };
}
export function codexToolProviderHeaders(provider) {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${provider.token}`);
    headers.set("ChatGPT-Account-ID", provider.accountId);
    headers.set("originator", CODEX_ORIGINATOR);
    headers.set("User-Agent", codexWebRunUserAgent(CODEX_ORIGINATOR));
    headers.set("version", "0.0.0");
    headers.set("content-type", "application/json");
    return headers;
}
export function codexWebRunUserAgent(originator = CODEX_ORIGINATOR) {
    const platform = process.platform === "darwin" ? "Mac OS" : process.platform === "win32" ? "Windows" : process.platform === "linux" ? "Linux" : process.platform;
    const release = "unknown";
    const arch = process.arch === "arm64" ? "arm64" : process.arch;
    const terminal = process.env["TERM_PROGRAM"]?.trim() || process.env["TERM"]?.trim() || "unknown";
    return `${originator}/0.0.0 (${platform} ${release}; ${arch}) ${terminal}`;
}
export function codexToolProviderEnv(provider) {
    return {
        ...process.env,
        PI_CODEX_ACCESS_TOKEN: provider.token,
        PI_CODEX_ACCOUNT_ID: provider.accountId,
        PI_CODEX_BASE_URL: provider.baseUrl,
        PI_CODEX_RESPONSES_URL: resolveCodexResponsesUrl(provider.baseUrl),
        ...(provider.model ? { PI_CODEX_MODEL: provider.model } : {}),
    };
}
