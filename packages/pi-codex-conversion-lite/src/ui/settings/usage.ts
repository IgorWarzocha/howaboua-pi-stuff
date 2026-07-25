import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const RESET_CREDITS_CACHE_MS = 5_000;

type RuntimeModel = Model<Api>;

export interface CodexUsageWindow {
	usedPercent?: number | undefined;
	windowMinutes?: number | undefined;
	resetsAt?: number | undefined;
}

export interface CodexUsageLimit {
	limitId: string;
	limitName?: string | undefined;
	primary?: CodexUsageWindow | undefined;
	secondary?: CodexUsageWindow | undefined;
}

export interface CodexUsageSnapshot {
	planType?: string | undefined;
	limits: CodexUsageLimit[];
	resetCredits?: CodexRateLimitResetCredits | undefined;
	raw: unknown;
}

export interface CodexRateLimitResetCredit {
	id?: string | undefined;
	resetType?: string | undefined;
	status?: string | undefined;
	grantedAt?: string | undefined;
	expiresAt?: string | undefined;
	redeemStartedAt?: string | undefined;
	redeemedAt?: string | undefined;
	title?: string | undefined;
	description?: string | undefined;
}

export interface CodexRateLimitResetCredits {
	availableCount: number;
	credits: CodexRateLimitResetCredit[];
	raw: unknown;
}

export type CodexRateLimitResetConsumeOutcome = "reset" | "already_redeemed" | "nothing_to_reset" | "no_credit" | "unknown";

export interface CodexRateLimitResetConsumeResult {
	outcome: CodexRateLimitResetConsumeOutcome;
	windowsReset?: number | undefined;
	raw: unknown;
}

let resetCreditsCache: { key: string; expiresAt: number; promise: Promise<CodexRateLimitResetCredits | undefined> } | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
	if (typeof value !== "string" || value.trim().length === 0) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : undefined;
}

export function buildCodexUsageUrl(): string {
	return `${DEFAULT_CODEX_BASE_URL}/wham/usage`;
}

export function buildCodexRateLimitResetCreditsUrl(): string {
	return `${DEFAULT_CODEX_BASE_URL}/wham/rate-limit-reset-credits`;
}

export function buildCodexRateLimitResetConsumeUrl(): string {
	return `${DEFAULT_CODEX_BASE_URL}/wham/rate-limit-reset-credits/consume`;
}

function extractBearerToken(headers: Headers): string | undefined {
	const authorization = headers.get("authorization")?.trim();
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim();
}

function extractAccountId(token: string): string | undefined {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return undefined;
		const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString("utf8")) as unknown;
		const authClaims = isRecord(payload) ? payload[JWT_CLAIM_PATH]! : undefined;
		const accountId = isRecord(authClaims) ? authClaims["chatgpt_account_id"]! : undefined;
		return stringValue(accountId);
	} catch {
		return undefined;
	}
}

async function buildCodexUsageHeaders(ctx: ExtensionContext, model: RuntimeModel): Promise<Headers> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	const headers = new Headers(model.headers);
	for (const [key, value] of Object.entries(auth.headers ?? {})) headers.set(key, value);
	if (auth.apiKey) headers.set("authorization", `Bearer ${auth.apiKey}`);
	const token = auth.apiKey ?? extractBearerToken(headers);
	const accountId = token ? extractAccountId(token) : undefined;
	if (accountId) headers.set("chatgpt-account-id", accountId);
	headers.set("accept", "application/json");
	headers.set("OAI-Language", "en");
	headers.set("originator", "pi");
	return headers;
}

function parseResetCredit(value: unknown): CodexRateLimitResetCredit | undefined {
	if (!isRecord(value)) return undefined;
	return {
		id: stringValue(value["id"]!),
		resetType: stringValue(value["reset_type"]!),
		status: stringValue(value["status"]!),
		grantedAt: stringValue(value["granted_at"]!),
		expiresAt: stringValue(value["expires_at"]!),
		redeemStartedAt: stringValue(value["redeem_started_at"]!),
		redeemedAt: stringValue(value["redeemed_at"]!),
		title: stringValue(value["title"]!),
		description: stringValue(value["description"]!),
	};
}

export function parseCodexRateLimitResetCreditsPayload(payload: unknown): CodexRateLimitResetCredits | undefined {
	const root = isRecord(payload) ? payload : undefined;
	if (!root) return undefined;
	const availableCount = integerValue(root["available_count"]!);
	if (availableCount === undefined) return undefined;
	const credits = Array.isArray(root["credits"]!) ? root["credits"]!.map(parseResetCredit).filter((credit): credit is CodexRateLimitResetCredit => Boolean(credit)) : [];
	return { availableCount, credits, raw: payload };
}

function parseCodexRateLimitResetCreditsSummary(value: unknown): CodexRateLimitResetCredits | undefined {
	if (!isRecord(value)) return undefined;
	const availableCount = integerValue(value["available_count"]!);
	return availableCount === undefined ? undefined : { availableCount, credits: [], raw: value };
}

function parseWindow(value: unknown): CodexUsageWindow | undefined {
	if (!isRecord(value)) return undefined;
	const usedPercent = numberValue(value["used_percent"]!);
	const limitWindowSeconds = numberValue(value["limit_window_seconds"]!);
	const windowMinutes = numberValue(value["window_minutes"]!) ?? (limitWindowSeconds === undefined ? undefined : Math.ceil(limitWindowSeconds / 60));
	const resetsAt = numberValue(value["resets_at"]!) ?? numberValue(value["reset_at"]!);
	return usedPercent === undefined && windowMinutes === undefined && resetsAt === undefined ? undefined : { usedPercent, windowMinutes, resetsAt };
}

function parseRateLimit(value: unknown): { primary?: CodexUsageWindow | undefined; secondary?: CodexUsageWindow | undefined } {
	if (!isRecord(value)) return {};
	return {
		primary: parseWindow(value["primary_window"]!) ?? parseWindow(value["primary"]!),
		secondary: parseWindow(value["secondary_window"]!) ?? parseWindow(value["secondary"]!),
	};
}

export function parseCodexUsagePayload(payload: unknown): CodexUsageSnapshot {
	const root = isRecord(payload) ? payload : {};
	const limits: CodexUsageLimit[] = [];
	const addLimit = (limitId: string, limitName: string | undefined, source: unknown) => {
		const rateLimit = isRecord(source) && "rate_limit" in source ? source["rate_limit"]! : source;
		const parsed = parseRateLimit(rateLimit);
		limits.push({
			limitId,
			...(limitName ? { limitName } : {}),
			...(parsed.primary ? { primary: parsed.primary } : {}),
			...(parsed.secondary ? { secondary: parsed.secondary } : {}),
		});
	};
	addLimit("codex", undefined, root["rate_limit"]!);
	if (Array.isArray(root["additional_rate_limits"]!)) {
		for (const item of root["additional_rate_limits"]!) {
			if (!isRecord(item)) continue;
			addLimit(stringValue(item["metered_feature"]!) ?? "additional", stringValue(item["limit_name"]!), item);
		}
	}
	return { planType: stringValue(root["plan_type"]!), limits, resetCredits: parseCodexRateLimitResetCreditsSummary(root["rate_limit_reset_credits"]!), raw: payload };
}

function resetCreditsCacheKey(headers: Headers): string | undefined {
	return headers.get("chatgpt-account-id")?.trim() || undefined;
}

async function fetchCodexRateLimitResetCreditsWithHeaders(headers: Headers, signal?: AbortSignal | undefined): Promise<CodexRateLimitResetCredits | undefined> {
	const cacheKey = resetCreditsCacheKey(headers);
	if (cacheKey && resetCreditsCache && resetCreditsCache.key === cacheKey && resetCreditsCache.expiresAt > Date.now()) return resetCreditsCache.promise;
	const promise = (async () => {
		const response = await fetch(buildCodexRateLimitResetCreditsUrl(), { method: "GET", headers, ...(signal ? { signal } : {}) });
		if (!response.ok) return undefined;
		return parseCodexRateLimitResetCreditsPayload(JSON.parse(await response.text()));
	})();
	if (cacheKey) resetCreditsCache = { key: cacheKey, expiresAt: Date.now() + RESET_CREDITS_CACHE_MS, promise };
	return promise;
}

export async function fetchCodexUsage(ctx: ExtensionContext): Promise<CodexUsageSnapshot> {
	const model = ctx.model;
	if (!model) throw new Error("No active model selected.");
	if (model.provider !== "openai-codex") {
		throw new Error("Codex usage is only available for OpenAI Codex subscription models.");
	}
	const headers = await buildCodexUsageHeaders(ctx, model);
	const response = await fetch(buildCodexUsageUrl(), { method: "GET", headers, ...(ctx.signal ? { signal: ctx.signal } : {}) });
	const text = await response.text();
	if (!response.ok) throw new Error(`Usage request failed (${response.status}): ${text || response.statusText}`);
	const snapshot = parseCodexUsagePayload(JSON.parse(text));
	if (!snapshot.resetCredits || snapshot.resetCredits.availableCount > 0) {
		try {
			const detailedResetCredits = await fetchCodexRateLimitResetCreditsWithHeaders(headers, ctx.signal);
			if (detailedResetCredits) snapshot.resetCredits = detailedResetCredits;
		} catch {
			// Detailed reset-credit metadata is additive; usage still renders if this endpoint fails.
		}
	}
	return snapshot;
}

export function createCodexRateLimitResetRedeemRequestId(): string {
	return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `pi_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function parseCodexRateLimitResetConsumePayload(payload: unknown): CodexRateLimitResetConsumeResult {
	const root = isRecord(payload) ? payload : {};
	const code = stringValue(root["code"]!);
	const outcome: CodexRateLimitResetConsumeOutcome = code === "reset" || code === "already_redeemed" || code === "nothing_to_reset" || code === "no_credit" ? code : "unknown";
	return { outcome, windowsReset: integerValue(root["windows_reset"]!), raw: payload };
}

export async function consumeCodexRateLimitResetCredit(ctx: ExtensionContext, redeemRequestId = createCodexRateLimitResetRedeemRequestId()): Promise<CodexRateLimitResetConsumeResult> {
	const model = ctx.model;
	if (!model) throw new Error("No active model selected.");
	if (model.provider !== "openai-codex") {
		throw new Error("Codex reset credits are only available for OpenAI Codex subscription models.");
	}
	const headers = await buildCodexUsageHeaders(ctx, model);
	headers.set("content-type", "application/json");
	resetCreditsCache = undefined;
	const response = await fetch(buildCodexRateLimitResetConsumeUrl(), {
		method: "POST",
		headers,
		body: JSON.stringify({ redeem_request_id: redeemRequestId }),
		...(ctx.signal ? { signal: ctx.signal } : {}),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Reset request failed (${response.status}): ${text || response.statusText}`);
	resetCreditsCache = undefined;
	return parseCodexRateLimitResetConsumePayload(JSON.parse(text));
}

function formatReset(timestampSeconds: number | undefined): string {
	if (!timestampSeconds) return "reset unknown";
	const ms = timestampSeconds * 1000;
	const minutes = Math.max(0, Math.round((ms - Date.now()) / 60000));
	return minutes < 90 ? `resets in ~${minutes}m` : `resets ${new Date(ms).toLocaleString()}`;
}

function formatWindow(label: string, window: CodexUsageWindow | undefined): string | undefined {
	if (!window) return undefined;
	const remainingPercent = window.usedPercent === undefined ? undefined : 100 - Math.max(0, Math.min(100, window.usedPercent));
	const percent = remainingPercent === undefined ? "?" : `${Math.round(remainingPercent)}%`;
	const span = window.windowMinutes ? `${Math.round(window.windowMinutes)}m` : "window";
	return `${label}: ${percent} left (${span}, ${formatReset(window.resetsAt)})`;
}

export function formatCodexUsage(snapshot: CodexUsageSnapshot): string {
	const lines = [`Codex usage${snapshot.planType ? ` (${snapshot.planType})` : ""}:`];
	if (snapshot.resetCredits) lines.push(`- resets available: ${snapshot.resetCredits.availableCount}`);
	for (const limit of snapshot.limits) {
		const title = limit.limitName ?? limit.limitId;
		const parts = [formatWindow("5h", limit.primary), formatWindow("weekly", limit.secondary)].filter(Boolean);
		lines.push(`- ${title}: ${parts.length ? parts.join("; ") : "no usage data"}`);
	}
	return lines.join("\n");
}
