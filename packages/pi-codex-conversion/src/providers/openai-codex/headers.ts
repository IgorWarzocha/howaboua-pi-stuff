import { DEFAULT_CODEX_BASE_URL, JWT_CLAIM_PATH, OPENAI_BETA_RESPONSES_WEBSOCKETS } from "./constants.ts";
import { osInfo } from "./node-runtime.ts";
import { RESPONSES_LITE_HEADER } from "./responses-lite.ts";

type ProviderHeaders = Record<string, string | null>;

export function extractAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString("utf8"));
		const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
		if (!accountId) throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}

export function resolveCodexUrl(baseUrl: string | undefined): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
	const normalized = raw.replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

export function resolveCodexWebSocketUrl(baseUrl: string | undefined): string {
	const url = new URL(resolveCodexUrl(baseUrl));
	if (url.protocol === "https:") url.protocol = "wss:";
	if (url.protocol === "http:") url.protocol = "ws:";
	return url.toString();
}

export function headersToRecord(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}

let lastRequestTimestamp = -Infinity;
let requestSequence = 0;

export function createCodexRequestId(): string {
	const random = new Uint8Array(16);
	if (globalThis.crypto?.getRandomValues) {
		globalThis.crypto.getRandomValues(random);
	} else {
		for (let index = 0; index < random.length; index++) {
			random[index] = Math.floor(Math.random() * 256);
		}
	}

	const timestamp = Date.now();
	if (timestamp > lastRequestTimestamp) {
		requestSequence =
			random[6]! * 0x1000000 +
			random[7]! * 0x10000 +
			random[8]! * 0x100 +
			random[9]!;
		lastRequestTimestamp = timestamp;
	} else {
		requestSequence = (requestSequence + 1) >>> 0;
		if (requestSequence === 0) lastRequestTimestamp++;
	}

	const bytes = new Uint8Array(16);
	bytes[0] = (lastRequestTimestamp / 0x10000000000) & 0xff;
	bytes[1] = (lastRequestTimestamp / 0x100000000) & 0xff;
	bytes[2] = (lastRequestTimestamp / 0x1000000) & 0xff;
	bytes[3] = (lastRequestTimestamp / 0x10000) & 0xff;
	bytes[4] = (lastRequestTimestamp / 0x100) & 0xff;
	bytes[5] = lastRequestTimestamp & 0xff;
	bytes[6] = 0x70 | ((requestSequence >>> 28) & 0x0f);
	bytes[7] = (requestSequence >>> 20) & 0xff;
	bytes[8] = 0x80 | ((requestSequence >>> 14) & 0x3f);
	bytes[9] = (requestSequence >>> 6) & 0xff;
	bytes[10] = ((requestSequence & 0x3f) << 2) | (random[10]! & 0x03);
	bytes.set(random.subarray(11), 11);

	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
	return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function buildBaseCodexHeaders(
	modelHeaders: Record<string, string> | undefined,
	additionalHeaders: ProviderHeaders | undefined,
	accountId: string,
	token: string,
): Headers {
	const headers = new Headers(modelHeaders);
	for (const [key, value] of Object.entries(additionalHeaders ?? {})) {
		if (value === null) {
			headers.delete(key);
		} else {
			headers.set(key, value);
		}
	}

	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("originator", "pi");
	const os = osInfo.current;
	headers.set("User-Agent", os ? `pi (${os.platform()} ${os.release()}; ${os.arch()})` : "pi (browser)");
	return headers;
}

export function buildSSEHeaders(
	modelHeaders: Record<string, string> | undefined,
	additionalHeaders: ProviderHeaders | undefined,
	accountId: string,
	token: string,
	sessionId: string | undefined,
	responsesLite = false,
): Headers {
	const headers = buildBaseCodexHeaders(modelHeaders, additionalHeaders, accountId, token);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	if (responsesLite) headers.set(RESPONSES_LITE_HEADER, "true");

	if (sessionId) {
		headers.set("session-id", sessionId);
		headers.set("thread-id", sessionId);
		headers.set("x-client-request-id", sessionId);
	}

	return headers;
}

export function buildWebSocketHeaders(
	modelHeaders: Record<string, string> | undefined,
	additionalHeaders: ProviderHeaders | undefined,
	accountId: string,
	token: string,
	requestId: string,
): Headers {
	const headers = buildBaseCodexHeaders(modelHeaders, additionalHeaders, accountId, token);
	headers.delete("accept");
	headers.delete("content-type");
	headers.delete("OpenAI-Beta");
	headers.delete("openai-beta");
	headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
	headers.set("x-client-request-id", requestId);
	headers.set("session-id", requestId);
	headers.set("thread-id", requestId);
	return headers;
}
