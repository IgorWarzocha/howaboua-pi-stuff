import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const DEFAULT_SUPPORTED_PROVIDERS = ["openai", "openai-codex"] as const;
export const DEFAULT_SUPPORTED_APIS = ["openai-responses", "openai-codex-responses"] as const;

type DefaultSupportedApi = (typeof DEFAULT_SUPPORTED_APIS)[number];

type RuntimeModel = Model<Api>;

type NativeCompactionFailureReason =
	| "disabled"
	| "missing-model"
	| "unsupported-provider"
	| "unsupported-api"
	| "missing-base-url"
	| "missing-api-key"
	| "unsupported-payload"
	| "payload-model-mismatch";

export type NativeCompactionSupportOptions = {
	enabled?: boolean | undefined;
	supportedProviders?: readonly string[] | undefined;
	supportedApis?: readonly string[] | undefined;
};

export type ResponsesCompatibleRequestPayload = {
	model: string;
	input: unknown[];
	instructions?: unknown | undefined;
	[key: string]: unknown;
};

export type NativeCompactionRuntime = {
	provider: string;
	api: DefaultSupportedApi;
	apiFamily: DefaultSupportedApi;
	model: string;
	baseUrl: string;
	apiKey?: string | undefined;
	headers?: Record<string, string> | undefined;
	payload?: ResponsesCompatibleRequestPayload | undefined;
	currentModel: RuntimeModel;
};

export type NativeCompactionEnvironmentFailure = {
	ok: false;
	reason: NativeCompactionFailureReason;
	provider?: string | undefined;
	api?: string | undefined;
	model?: string | undefined;
	baseUrl?: string | undefined;
};

export type NativeCompactionEnvironmentSuccess = {
	ok: true;
	runtime: NativeCompactionRuntime;
};

export type NativeCompactionEnvironmentResolution =
	| NativeCompactionEnvironmentFailure
	| NativeCompactionEnvironmentSuccess;

function normalizeConfiguredSet(values: readonly string[] | undefined, defaults: readonly string[]): Set<string> {
	const source = values && values.length > 0 ? values : defaults;
	return new Set(source.map((value) => value.trim()).filter((value) => value.length > 0));
}

function normalizeConfiguredProviderSet(values: readonly string[] | undefined): Set<string> {
	return new Set([...normalizeConfiguredSet(values, DEFAULT_SUPPORTED_PROVIDERS)].map((value) => value.toLowerCase()));
}

export function normalizeBaseUrl(baseUrl: string | undefined | null): string | undefined {
	const normalized = baseUrl?.trim().replace(/\/+$/, "");
	return normalized ? normalized : undefined;
}

async function resolveRequestAuth(
	ctx: ExtensionContext,
	model: RuntimeModel,
): Promise<{ apiKey?: string | undefined; headers?: Record<string, string> | undefined }> {
	const modelRegistry = ctx.modelRegistry as {
		getApiKeyAndHeaders?: (currentModel: RuntimeModel) => Promise<
			| { ok: true; apiKey?: string | undefined; headers?: Record<string, string> | undefined }
			| { ok: false; error: string }
		> | undefined;
	};

	if (typeof modelRegistry.getApiKeyAndHeaders !== "function") {
		return {};
	}

	const auth = await modelRegistry.getApiKeyAndHeaders(model);
	return auth && auth.ok ? { apiKey: auth.apiKey, headers: auth.headers } : {};
}

export function isSupportedApi(api: string): api is DefaultSupportedApi {
	return (DEFAULT_SUPPORTED_APIS as readonly string[]).includes(api);
}

export function isResponsesCompatiblePayload(payload: unknown): payload is ResponsesCompatibleRequestPayload {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return false;
	}

	const candidate = payload as Record<string, unknown>;
	return typeof candidate["model"]! === "string" && Array.isArray(candidate["input"]!);
}

export function getRuntimeModelDescriptor(model: RuntimeModel | undefined): {
	provider?: string | undefined;
	api?: string | undefined;
	model?: string | undefined;
	baseUrl?: string | undefined;
} {
	if (!model) {
		return {};
	}

	return {
		provider: model.provider,
		api: model.api,
		model: model.id,
		baseUrl: normalizeBaseUrl(model.baseUrl),
	};
}

export async function resolveNativeCompactionEnvironment(
	ctx: ExtensionContext,
	options: NativeCompactionSupportOptions = {},
	payload?: unknown,
): Promise<NativeCompactionEnvironmentResolution> {
	if (options.enabled === false) {
		return {
			ok: false,
			reason: "disabled",
		};
	}

	const currentModel = ctx.model;
	const descriptor = getRuntimeModelDescriptor(currentModel);
	if (!currentModel || !descriptor.provider || !descriptor.api || !descriptor.model) {
		return {
			ok: false,
			reason: "missing-model",
			...descriptor,
		};
	}

	const supportedProviders = normalizeConfiguredProviderSet(options.supportedProviders);
	if (!supportedProviders.has(descriptor.provider.trim().toLowerCase())) {
		return {
			ok: false,
			reason: "unsupported-provider",
			...descriptor,
		};
	}

	const supportedApis = normalizeConfiguredSet(options.supportedApis, DEFAULT_SUPPORTED_APIS);
	if (!supportedApis.has(descriptor.api)) {
		return {
			ok: false,
			reason: "unsupported-api",
			...descriptor,
		};
	}

	if (!isSupportedApi(descriptor.api)) {
		return {
			ok: false,
			reason: "unsupported-api",
			...descriptor,
		};
	}

	if (!descriptor.baseUrl) {
		return {
			ok: false,
			reason: "missing-base-url",
			...descriptor,
		};
	}

	let requestPayload: ResponsesCompatibleRequestPayload | undefined;
	if (payload !== undefined) {
		if (!isResponsesCompatiblePayload(payload)) {
			return {
				ok: false,
				reason: "unsupported-payload",
				...descriptor,
			};
		}

		if (payload.model !== descriptor.model) {
			return {
				ok: false,
				reason: "payload-model-mismatch",
				...descriptor,
			};
		}

		requestPayload = payload;
	}

	const { apiKey, headers } = await resolveRequestAuth(ctx, currentModel);
	const hasAuthorizationHeader = Object.entries(headers ?? {}).some(([key, value]) => key.toLowerCase() === "authorization" && value.trim().length > 0);
	if (!apiKey && !hasAuthorizationHeader) {
		return {
			ok: false,
			reason: "missing-api-key",
			...descriptor,
		};
	}

	return {
		ok: true,
		runtime: {
			provider: descriptor.provider,
			api: descriptor.api,
			apiFamily: descriptor.api,
			model: descriptor.model,
			baseUrl: descriptor.baseUrl,
			apiKey,
			headers,
			payload: requestPayload,
			currentModel,
		},
	};
}

export async function getNativeCompactionRuntime(
	ctx: ExtensionContext,
	options: NativeCompactionSupportOptions = {},
	payload?: unknown,
): Promise<NativeCompactionRuntime | undefined> {
	const resolution = await resolveNativeCompactionEnvironment(ctx, options, payload);
	return resolution.ok ? resolution.runtime : undefined;
}
