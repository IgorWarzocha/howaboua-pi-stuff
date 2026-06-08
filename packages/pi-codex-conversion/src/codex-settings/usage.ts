import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

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
	raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function buildCodexUsageUrl(): string {
	return `${DEFAULT_CODEX_BASE_URL}/wham/usage`;
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
	headers.set("originator", "pi");
	return headers;
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
	return { planType: stringValue(root["plan_type"]!), limits, raw: payload };
}

export async function fetchCodexUsage(ctx: ExtensionContext): Promise<CodexUsageSnapshot> {
	const model = ctx.model;
	if (!model) throw new Error("No active model selected.");
	if (model.provider !== "openai-codex") {
		throw new Error("Codex usage is only available for OpenAI Codex subscription models.");
	}
	const response = await fetch(buildCodexUsageUrl(), { method: "GET", headers: await buildCodexUsageHeaders(ctx, model), ...(ctx.signal ? { signal: ctx.signal } : {}) });
	const text = await response.text();
	if (!response.ok) throw new Error(`Usage request failed (${response.status}): ${text || response.statusText}`);
	return parseCodexUsagePayload(JSON.parse(text));
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
	for (const limit of snapshot.limits) {
		const title = limit.limitName ?? limit.limitId;
		const parts = [formatWindow("5h", limit.primary), formatWindow("weekly", limit.secondary)].filter(Boolean);
		lines.push(`- ${title}: ${parts.length ? parts.join("; ") : "no usage data"}`);
	}
	return lines.join("\n");
}
