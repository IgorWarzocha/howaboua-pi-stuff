import type { NativeCompactionRuntime } from "./compaction-runtime.ts";
import type { NativeCompactionRequestBody } from "./serializer.ts";

const JSON_CONTENT_TYPE = "application/json";

type CompactResponseEnvelope = {
	id?: string | undefined;
	created_at?: number | string | undefined;
	output: unknown[];
	[key: string]: unknown;
};

export type NativeCompactionClientFailureReason =
	| "aborted"
	| "network-error"
	| "non-2xx"
	| "empty-body"
	| "invalid-json"
	| "malformed-response"
	| "empty-output";

export type NativeCompactionClientSuccess = {
	ok: true;
	status: number;
	compactedWindow: unknown[];
	compactResponseId?: string | undefined;
	createdAt?: string | undefined;
	response: CompactResponseEnvelope;
};

export type NativeCompactionClientFailure = {
	ok: false;
	reason: NativeCompactionClientFailureReason;
	status?: number | undefined;
	errorMessage?: string | undefined;
	responseText?: string | undefined;
	responseJson?: unknown | undefined;
};

export type NativeCompactionClientResult = NativeCompactionClientSuccess | NativeCompactionClientFailure;

export type ExecuteNativeCompactionOptions = {
	runtime: NativeCompactionRuntime;
	request: NativeCompactionRequestBody;
	signal?: AbortSignal | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && (error.name === "AbortError" || error.name === "ABORT_ERR"))
	);
}

function normalizeResponseTimestamp(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
		return new Date(milliseconds).toISOString();
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? trimmed : new Date(parsed).toISOString();
}

function isCompactOutputItem(value: unknown): value is Record<string, unknown> {
	return isRecord(value);
}

function isCompactResponseEnvelope(value: unknown): value is CompactResponseEnvelope {
	return isRecord(value) && Array.isArray(value["output"]!) && value["output"]!.every(isCompactOutputItem);
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return undefined;
	}

	try {
		const payloadText = Buffer.from(parts[1]!, "base64url").toString("utf8");
		const payload = JSON.parse(payloadText);
		return isRecord(payload) ? payload : undefined;
	} catch {
		return undefined;
	}
}

function extractCodexAccountId(token: string): string | undefined {
	const payload = decodeJwtPayload(token);
	const authClaims = payload?.["https://api.openai.com/auth"];
	if (!isRecord(authClaims)) {
		return undefined;
	}

	const accountId = authClaims["chatgpt_account_id"]!;
	return typeof accountId === "string" && accountId.trim().length > 0 ? accountId.trim() : undefined;
}

function buildCodexUserAgent(): string {
	const platform = typeof process !== "undefined" ? process.platform : "browser";
	const arch = typeof process !== "undefined" ? process.arch : "unknown";
	return `pi (${platform}; ${arch})`;
}

function extractBearerToken(headers: Headers): string | undefined {
	const authorization = headers.get("authorization")?.trim();
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || undefined;
}

function toHeaders(runtime: NativeCompactionRuntime): Record<string, string> {
	const headers = new Headers(runtime.currentModel.headers ?? {});
	for (const [key, value] of Object.entries(runtime.headers ?? {})) {
		headers.set(key, value);
	}
	headers.set("accept", JSON_CONTENT_TYPE);
	headers.set("content-type", JSON_CONTENT_TYPE);
	if (runtime.apiKey) {
		headers.set("authorization", `Bearer ${runtime.apiKey}`);
	}

	if (runtime.provider === "openai-codex") {
		const accountId = extractCodexAccountId(runtime.apiKey ?? extractBearerToken(headers) ?? "");
		if (accountId) {
			headers.set("chatgpt-account-id", accountId);
		}
		headers.set("originator", "pi");
		headers.set("user-agent", buildCodexUserAgent());
		headers.set("openai-beta", "responses=experimental");
	}

	return Object.fromEntries(headers.entries());
}

export async function executeNativeCompaction(
	options: ExecuteNativeCompactionOptions,
): Promise<NativeCompactionClientResult> {
	const { runtime, request, signal } = options;
	const headers = toHeaders(runtime);

	if (signal?.aborted) {
		const aborted: NativeCompactionClientFailure = {
			ok: false,
			reason: "aborted",
		};
		return aborted;
	}

	try {
		const response = await fetch(runtime.compactUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(request),
			...(signal ? { signal } : {}),
		});
		const responseText = await response.text();

		if (!response.ok) {
			let responseJson: unknown;
			if (responseText.trim().length > 0) {
				try {
					responseJson = JSON.parse(responseText);
				} catch {
					responseJson = undefined;
				}
			}

			const failure: NativeCompactionClientFailure = {
				ok: false,
				reason: "non-2xx",
				status: response.status,
				responseText: responseText || undefined,
				responseJson,
			};
			return failure;
		}

		if (!responseText.trim()) {
			const failure: NativeCompactionClientFailure = {
				ok: false,
				reason: "empty-body",
				status: response.status,
			};
			return failure;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText);
		} catch (error) {
			const failure: NativeCompactionClientFailure = {
				ok: false,
				reason: "invalid-json",
				status: response.status,
				errorMessage: error instanceof Error ? error.message : String(error),
				responseText,
			};
			return failure;
		}

		if (!isCompactResponseEnvelope(parsed)) {
			const failure: NativeCompactionClientFailure = {
				ok: false,
				reason: "malformed-response",
				status: response.status,
				responseJson: parsed,
			};
			return failure;
		}

		if (parsed.output.length === 0) {
			const failure: NativeCompactionClientFailure = {
				ok: false,
				reason: "empty-output",
				status: response.status,
				responseJson: parsed,
			};
			return failure;
		}

		const success: NativeCompactionClientSuccess = {
			ok: true,
			status: response.status,
			compactedWindow: [...parsed.output],
			compactResponseId: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined,
			createdAt: normalizeResponseTimestamp(parsed.created_at),
			response: parsed,
		};
		return success;
	} catch (error) {
		const failure: NativeCompactionClientFailure = isAbortError(error)
			? {
				ok: false,
				reason: "aborted",
			}
			: {
				ok: false,
				reason: "network-error",
				errorMessage: error instanceof Error ? error.message : String(error),
			};

		return failure;
	}
}
