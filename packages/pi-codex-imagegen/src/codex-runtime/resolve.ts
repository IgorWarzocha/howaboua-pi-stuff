import type { Model, ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AllowConfiguredCodexToolProvider,
	CODEX_TOOL_PROVIDER_UNSUPPORTED_MESSAGE,
	type CodexToolProvider,
	OPENAI_CODEX_PROVIDER,
} from "./types.js";
import {
	resolveCodexApiProviderBaseUrl,
	resolveCodexResponsesUrl,
	resolveCodexSearchUrl,
} from "./urls.js";

const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const PREFERRED_MODELS = [
	"gpt-5.6-luna",
	"gpt-5.6-terra",
	"gpt-5.6-sol",
	"gpt-5.5",
	"gpt-5.4-mini",
	"gpt-5.3-codex-spark",
];

function isOpenAICodexModel(
	model: Partial<Model<any>> | null | undefined,
): boolean {
	return (model?.provider ?? "").trim().toLowerCase() === OPENAI_CODEX_PROVIDER;
}

function isCodexTransportModel(
	model: Partial<Model<any>> | null | undefined,
	isConfiguredCodexTransport?: AllowConfiguredCodexToolProvider,
): boolean {
	return Boolean(
		model &&
			(isOpenAICodexModel(model) ||
				(model.api ?? "").trim().toLowerCase() === "openai-codex-responses" ||
				isConfiguredCodexTransport?.(model as ExtensionContext["model"])),
	);
}

function isResponsesModel(model: ExtensionContext["model"]): boolean {
	return Boolean(model?.api?.includes("responses"));
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

function extractAccountId(token: string): string {
	try {
		const payload = token.split(".")[1];
		if (!payload) throw new Error("Invalid token");
		const claims = JSON.parse(
			Buffer.from(payload, "base64").toString("utf8"),
		) as Record<string, unknown>;
		const auth = claims[JWT_CLAIM_PATH];
		const accountId =
			auth && typeof auth === "object"
				? (auth as Record<string, unknown>)["chatgpt_account_id"]
				: undefined;
		if (typeof accountId !== "string" || !accountId)
			throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}

function resolveOpenAICodexAuthModel(
	ctx: ExtensionContext,
): Model<any> | undefined {
	const registry = ctx.modelRegistry as {
		find?: (provider: string, modelId: string) => Model<any> | undefined;
		getAvailable?: () => Model<any>[];
		getAll?: () => Model<any>[];
	};
	const usable = (model: ExtensionContext["model"]): model is Model<any> =>
		isOpenAICodexModel(model) && isResponsesModel(model);
	const currentId = ctx.model?.id;
	const direct = currentId
		? registry.find?.(OPENAI_CODEX_PROVIDER, currentId)
		: undefined;
	if (usable(direct)) return direct;
	const preferred = PREFERRED_MODELS.map((id) =>
		registry.find?.(OPENAI_CODEX_PROVIDER, id),
	).find(usable);
	if (preferred) return preferred;
	return (
		registry.getAvailable?.().find(usable) ?? registry.getAll?.().find(usable)
	);
}

export function resolveAuthModel(
	ctx: ExtensionContext,
	allowConfiguredProvider?: AllowConfiguredCodexToolProvider,
	isConfiguredCodexTransport?: AllowConfiguredCodexToolProvider,
): Model<any> {
	if (isConfiguredCodexTransport?.(ctx.model)) return ctx.model as Model<any>;
	if (isCodexTransportModel(ctx.model) && isResponsesModel(ctx.model))
		return ctx.model as Model<any>;
	if (isResponsesModel(ctx.model) && allowConfiguredProvider?.(ctx.model))
		return ctx.model as Model<any>;
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
	return base.endsWith("/responses") ? base : base + "/responses";
}

export async function resolveCodexToolProvider(
	ctx: ExtensionContext,
	allowConfiguredProvider?: AllowConfiguredCodexToolProvider,
	isConfiguredCodexTransport?: AllowConfiguredCodexToolProvider,
): Promise<CodexToolProvider> {
	const model = resolveAuthModel(
		ctx,
		allowConfiguredProvider,
		isConfiguredCodexTransport,
	);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	const resolvedBaseUrl = auth.baseUrl ?? model.baseUrl;
	const codexTransport = isCodexTransportModel(
		model,
		isConfiguredCodexTransport,
	);
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
