import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { isCanonicalCodexBaseUrl, isCanonicalCodexSubscriptionModel, isStandardCodexSubscriptionModel } from "../adapter/prompt/codex-model.ts";
import { DEFAULT_CODEX_BASE_URL, JWT_CLAIM_PATH } from "../providers/openai-codex/constants.ts";
import { parseCodexReserveStatus, type CodexReserveStatus } from "./reserve-policy.ts";
import {
	codexUsageStatus,
	type CodexRateLimitResetConsumeResult,
	type CodexRateLimitResetCredits,
	type CodexUsageSnapshot,
	type CodexUsageStatus,
	parseCodexRateLimitResetConsumePayload,
	parseCodexRateLimitResetCreditsPayload,
	parseCodexUsagePayload,
} from "./payload.ts";

const RESET_CREDITS_CACHE_MS = 5_000;
const USAGE_STATUS_CACHE_MS = 5 * 60_000;
const USAGE_TIMEOUT_MS = 10_000;

type RuntimeModel = Model<Api>;
interface CodexUsageRequest { headers: Headers; baseUrl: string; nonstandard: boolean }

let resetCreditsCache: { key: string; expiresAt: number; promise: Promise<CodexRateLimitResetCredits | undefined> } | undefined;
const usageStatusCache = new Map<string, {
	value?: CodexUsageStatus | undefined;
	expiresAt: number;
	promise?: Promise<CodexUsageStatus | undefined> | undefined;
}>();
const usageStatusKeyByModel = new WeakMap<RuntimeModel, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function usageBaseUrl(baseUrl: string): string {
	// Match the root, /codex and /codex/responses forms accepted by the transport.
	return baseUrl.replace(/\/+$/, "").replace(/\/codex(?:\/responses)?$/, "");
}

export function buildCodexUsageUrl(baseUrl = DEFAULT_CODEX_BASE_URL): string {
	return `${usageBaseUrl(baseUrl)}/wham/usage`;
}

export function buildCodexRateLimitResetCreditsUrl(baseUrl = DEFAULT_CODEX_BASE_URL): string {
	return `${usageBaseUrl(baseUrl)}/wham/rate-limit-reset-credits`;
}

export function buildCodexRateLimitResetConsumeUrl(baseUrl = DEFAULT_CODEX_BASE_URL): string {
	return `${usageBaseUrl(baseUrl)}/wham/rate-limit-reset-credits/consume`;
}

function extractIdentity(token: string): { accountId?: string | undefined; userId?: string | undefined; fedramp?: boolean | undefined } {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return {};
		const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString("utf8")) as unknown;
		const authClaims = isRecord(payload) ? payload[JWT_CLAIM_PATH]! : undefined;
		if (!isRecord(authClaims)) return {};
		return {
			accountId: stringValue(authClaims["chatgpt_account_id"]),
			userId: stringValue(authClaims["chatgpt_user_id"]) ?? stringValue(authClaims["user_id"]),
			fedramp: authClaims["chatgpt_account_is_fedramp"] === true,
		};
	} catch {
		return {};
	}
}

async function resolveCodexUsageRequest(ctx: ExtensionContext, model: RuntimeModel): Promise<CodexUsageRequest> {
	if (model.api !== "openai-codex-responses") throw new Error("Codex usage requires the openai-codex-responses API.");
	const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!resolved.ok) throw new Error(resolved.error);
	const token = resolved.apiKey;
	if (!token) throw new Error("OpenAI Codex subscription auth is required.");
	const { accountId } = extractIdentity(token);
	if (!accountId) throw new Error("OpenAI Codex subscription auth with an account ID is required.");
	const baseUrl = resolved.baseUrl ?? model.baseUrl;
	const headers = new Headers(model.headers);
	for (const [name, value] of Object.entries(resolved.headers ?? {})) {
		if (value === null) headers.delete(name);
		else headers.set(name, value);
	}
	headers.set("authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("accept", "application/json");
	headers.set("OAI-Language", "en");
	headers.set("originator", "pi");
	return { headers, baseUrl, nonstandard: !isStandardCodexSubscriptionModel(model) || !isCanonicalCodexBaseUrl(baseUrl) };
}

function usageCacheKey(request: CodexUsageRequest): string {
	return JSON.stringify([usageBaseUrl(request.baseUrl), request.headers.get("chatgpt-account-id")]);
}

async function fetchCodexRateLimitResetCredits(request: CodexUsageRequest, signal?: AbortSignal | undefined): Promise<CodexRateLimitResetCredits | undefined> {
	const cacheKey = usageCacheKey(request);
	if (resetCreditsCache && resetCreditsCache.key === cacheKey && resetCreditsCache.expiresAt > Date.now()) return resetCreditsCache.promise;
	const promise = (async () => {
		const response = await fetch(buildCodexRateLimitResetCreditsUrl(request.baseUrl), { method: "GET", headers: request.headers, ...(signal ? { signal } : {}) });
		if (!response.ok) return undefined;
		return parseCodexRateLimitResetCreditsPayload(JSON.parse(await response.text()));
	})();
	resetCreditsCache = { key: cacheKey, expiresAt: Date.now() + RESET_CREDITS_CACHE_MS, promise };
	return promise;
}

async function fetchCodexUsageRequest(
	request: CodexUsageRequest,
	signal?: AbortSignal | undefined,
	includeDetailedResetCredits = true,
): Promise<CodexUsageSnapshot> {
	const response = await fetch(buildCodexUsageUrl(request.baseUrl), { method: "GET", headers: request.headers, ...(signal ? { signal } : {}) });
	const text = await response.text();
	if (!response.ok) throw new Error(`Usage request failed (${response.status}): ${text || response.statusText}`);
	const snapshot = parseCodexUsagePayload(JSON.parse(text));
	const accountId = request.headers.get("chatgpt-account-id");
	if (accountId) snapshot.accountKey = createHash("sha256").update(accountId).digest("hex");
	if (request.nonstandard) snapshot.nonstandard = true;
	if (includeDetailedResetCredits && (!snapshot.resetCredits || snapshot.resetCredits.availableCount > 0)) {
		try {
			const detailedResetCredits = await fetchCodexRateLimitResetCredits(request, signal);
			if (detailedResetCredits) snapshot.resetCredits = detailedResetCredits;
		} catch {
			// Detailed reset-credit metadata is additive; usage still renders if this endpoint fails.
		}
	}
	return snapshot;
}

export async function fetchCodexUsage(ctx: ExtensionContext, onAccount?: (key: string, nonstandard: boolean) => void): Promise<CodexUsageSnapshot> {
	const model = ctx.model;
	if (!model) throw new Error("No active model selected.");
	const request = await resolveCodexUsageRequest(ctx, model);
	const accountId = request.headers.get("chatgpt-account-id");
	if (accountId) onAccount?.(createHash("sha256").update(accountId).digest("hex"), request.nonstandard);
	return fetchCodexUsageRequest(request, ctx.signal);
}

// Only the fallback controller opts in. Passive usage reads must not expose the experiment.
export async function fetchCodexReserveStatus(ctx: ExtensionContext): Promise<CodexReserveStatus | undefined> {
	const model = ctx.model;
	if (!model || !isCanonicalCodexSubscriptionModel(model)) return undefined;
	const signal = ctx.signal
		? AbortSignal.any([ctx.signal, AbortSignal.timeout(USAGE_TIMEOUT_MS)])
		: AbortSignal.timeout(USAGE_TIMEOUT_MS);
	const request = await withAbort(resolveCodexUsageRequest(ctx, model), signal);
	if (!isCanonicalCodexBaseUrl(request.baseUrl)) return undefined;
	const { accountId, userId, fedramp } = extractIdentity((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
	if (!accountId || !userId || fedramp) return undefined;
	request.headers.set("x-openai-codex-luna-reserve", "1");
	const snapshot = await fetchCodexUsageRequest(request, signal, false);
	const currentRequest = await withAbort(resolveCodexUsageRequest(ctx, model), signal);
	const current = extractIdentity((currentRequest.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
	if (!isCanonicalCodexBaseUrl(currentRequest.baseUrl) || current.accountId !== accountId || current.userId !== userId || current.fedramp) return undefined;
	return parseCodexReserveStatus(snapshot.raw, { accountId, userId }, model.id);
}

export async function fetchCodexUsageStatus(ctx: ExtensionContext): Promise<CodexUsageStatus | undefined> {
	const model = ctx.model;
	if (!model || model.api !== "openai-codex-responses") return undefined;
	const timeoutSignal = AbortSignal.timeout(USAGE_TIMEOUT_MS);
	const signal = ctx.signal
		? AbortSignal.any([ctx.signal, timeoutSignal])
		: timeoutSignal;
	try {
		const request = await withAbort(resolveCodexUsageRequest(ctx, model), signal);
		const key = usageCacheKey(request);
		usageStatusKeyByModel.set(model, key);
		const cached = usageStatusCache.get(key);
		if (cached?.expiresAt && cached.expiresAt > Date.now()) return cached.value;
		if (cached?.promise) return cached.promise;
		const entry = cached ?? { expiresAt: 0 };
		const previous = entry.value;
		const promise = (async () => {
			try {
				entry.value = codexUsageStatus(
					await fetchCodexUsageRequest(request, signal, false),
				);
				entry.expiresAt = Date.now() + USAGE_STATUS_CACHE_MS;
			} catch {
				entry.value = previous;
			} finally {
				entry.promise = undefined;
			}
			return entry.value;
		})();
		entry.promise = promise;
		usageStatusCache.set(key, entry);
		return promise;
	} catch {
		const previousKey = usageStatusKeyByModel.get(model);
		return previousKey ? usageStatusCache.get(previousKey)?.value : undefined;
	}
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

export function createCodexRateLimitResetRedeemRequestId(): string {
	return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `pi_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function consumeCodexRateLimitResetCredit(ctx: ExtensionContext, redeemRequestId = createCodexRateLimitResetRedeemRequestId()): Promise<CodexRateLimitResetConsumeResult> {
	const model = ctx.model;
	if (!model) throw new Error("No active model selected.");
	const request = await resolveCodexUsageRequest(ctx, model);
	const { headers } = request;
	headers.set("content-type", "application/json");
	resetCreditsCache = undefined;
	const response = await fetch(buildCodexRateLimitResetConsumeUrl(request.baseUrl), {
		method: "POST",
		headers,
		body: JSON.stringify({ redeem_request_id: redeemRequestId }),
		...(ctx.signal ? { signal: ctx.signal } : {}),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Reset request failed (${response.status}): ${text || response.statusText}`);
	resetCreditsCache = undefined;
	const result = parseCodexRateLimitResetConsumePayload(JSON.parse(text));
	if (result.outcome === "reset" || result.outcome === "already_redeemed") {
		usageStatusCache.delete(usageCacheKey(request));
	}
	return result;
}
