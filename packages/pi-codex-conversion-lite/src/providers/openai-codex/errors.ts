import type { AssistantMessage } from "@earendil-works/pi-ai";

export class NonRetryableProviderError extends Error {}

type CodexErrorEnvelope = {
	status_code?: number | undefined;
	error?: {
		code?: string | undefined;
		type?: string | undefined;
		message?: string | undefined;
		plan_type?: string | undefined;
		resets_at?: number | undefined;
		resets_in_seconds?: number | undefined;
	} | undefined;
	headers?: Record<string, string | number | undefined> | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJsonObject(value: string): unknown | undefined {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function extractJsonObjectFromMessage(message: string): unknown | undefined {
	const start = message.indexOf("{");
	if (start < 0) return undefined;
	for (let end = message.length; end > start; end -= 1) {
		const candidate = message.slice(start, end).trim();
		const parsed = parseJsonObject(candidate);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

function normalizeCodexErrorEnvelope(value: unknown): CodexErrorEnvelope | undefined {
	if (!isRecord(value)) return undefined;
	const error = isRecord(value["error"]!) ? value["error"]! : undefined;
	const headers = isRecord(value["headers"]!) ? value["headers"]! : undefined;
	return {
		status_code: asNumber(value["status_code"]!),
		error: error ? {
			code: asString(error["code"]!),
			type: asString(error["type"]!),
			message: asString(error["message"]!),
			plan_type: asString(error["plan_type"]!),
			resets_at: asNumber(error["resets_at"]!),
			resets_in_seconds: asNumber(error["resets_in_seconds"]!),
		} : undefined,
		headers: headers as Record<string, string | number | undefined> | undefined,
	};
}

function header(headers: Record<string, string | number | undefined> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name.toLowerCase()) return asString(value) ?? (typeof value === "number" ? String(value) : undefined);
	}
	return undefined;
}

function formatReset(seconds: number | undefined, resetsAt: number | undefined): string | undefined {
	const remaining = seconds ?? (resetsAt ? Math.max(0, Math.round(resetsAt - Date.now() / 1000)) : undefined);
	if (remaining === undefined) return undefined;
	const minutes = Math.max(0, Math.round(remaining / 60));
	if (minutes < 90) return `Resets in ~${minutes}m.`;
	const hours = Math.round((minutes / 60) * 10) / 10;
	return `Resets in ~${hours}h.`;
}

function formatLimitUsage(headers: Record<string, string | number | undefined> | undefined, prefix: string, label: string): string | undefined {
	const primary = header(headers, `${prefix}Primary-Used-Percent`);
	const secondary = header(headers, `${prefix}Secondary-Used-Percent`);
	if (!primary && !secondary) return undefined;
	const parts = [primary ? `5h ${primary}%` : undefined, secondary ? `weekly ${secondary}%` : undefined].filter(Boolean);
	return `${label}: ${parts.join(", ")}.`;
}

export function formatCodexUsageLimitError(value: unknown): string | undefined {
	const envelope = normalizeCodexErrorEnvelope(typeof value === "string" ? (parseJsonObject(value) ?? extractJsonObjectFromMessage(value)) : value);
	if (!envelope) return undefined;
	const code = envelope.error?.code ?? envelope.error?.type ?? "";
	if (!/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) && envelope.status_code !== 429) return undefined;

	const plan = envelope.error?.plan_type ? ` (${envelope.error.plan_type.toLowerCase()} plan)` : "";
	const reset = formatReset(envelope.error?.resets_in_seconds ?? asNumber(header(envelope.headers, "X-Codex-Primary-Reset-After-Seconds")), envelope.error?.resets_at ?? asNumber(header(envelope.headers, "X-Codex-Primary-Reset-At")));
	const activeLimit = header(envelope.headers, "X-Codex-Active-Limit");
	const main = formatLimitUsage(envelope.headers, "X-Codex-", activeLimit ? `Current ${activeLimit}` : "Current limit");
	const extraName = header(envelope.headers, "X-Codex-Bengalfox-Limit-Name");
	const extra = formatLimitUsage(envelope.headers, "X-Codex-Bengalfox-", extraName ? `Extra ${extraName}` : "Extra limit");
	return [
		`Codex usage limit reached${plan}.`,
		reset,
		main,
		extra,
	].filter(Boolean).join(" ");
}

export function isRetryableError(status: number, errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
		return true;
	}
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}

export function buildProviderErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const usageLimitMessage = formatCodexUsageLimitError(message);
	if (usageLimitMessage) return usageLimitMessage;
	if (/^(?:WebSocket (?:error|closed|connect timeout|idle timeout)|WebSocket stream closed before response\.completed|Stream closed before response\.completed)/.test(message)) {
		return `Connection error: ${message}`;
	}
	return message;
}

export function createErrorMessage(message: AssistantMessage, error: unknown, aborted: boolean): AssistantMessage {
	for (const block of message.content) {
		if (typeof block === "object" && block !== null && "partialJson" in block) {
			delete (block as { partialJson?: string | undefined }).partialJson;
		}
	}
	message.stopReason = aborted ? "aborted" : "error";
	message.errorMessage = buildProviderErrorMessage(error);
	return message;
}

export async function parseErrorResponse(response: Response): Promise<{ message: string; friendlyMessage?: string | undefined }> {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;

	try {
		const parsed = JSON.parse(raw) as { error?: { code?: string | undefined; type?: string | undefined; plan_type?: string | undefined; resets_at?: number | undefined; message?: string | undefined } | undefined };
		friendlyMessage = formatCodexUsageLimitError({ ...parsed, status_code: response.status, headers: Object.fromEntries(response.headers.entries()) });
		const err = parsed?.error;
		if (err) {
			const code = err.code || err.type || "";
			if (!friendlyMessage && (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429)) {
				const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
				const mins = err.resets_at ? Math.max(0, Math.round((err.resets_at * 1000 - Date.now()) / 60000)) : undefined;
				const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
			}
			message = friendlyMessage || err.message || message;
		}
	} catch {
		// ignore malformed error bodies
	}

	return { message, friendlyMessage };
}
