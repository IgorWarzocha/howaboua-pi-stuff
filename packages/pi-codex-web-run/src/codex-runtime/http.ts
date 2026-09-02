// @ts-expect-error proxy-from-env ships no declarations.
import { getProxyForUrl } from "proxy-from-env";
import { fetch, ProxyAgent } from "undici";
import {
	ChatGptCloudflareCookieStore,
	isChatGptCookieUrl,
} from "./cloudflare-cookies.js";

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const cloudflareCookies = new ChatGptCloudflareCookieStore();

export interface CodexToolHttpResponse {
	status: number;
	statusText: string;
	headers: Headers;
	text: string;
}

export async function fetchCodexTool(
	url: string,
	options: {
		method?: string;
		headers?: Headers;
		body?: string;
		signal?: AbortSignal | null;
		maxResponseBytes?: number;
	},
): Promise<CodexToolHttpResponse> {
	const proxy = getProxyForUrl(url);
	const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
	let currentUrl = new URL(url);
	let method = options.method;
	let body = options.body;
	const baseHeaders = new Headers(options.headers);
	try {
		for (let redirects = 0; ; redirects += 1) {
			const chatGptRequest = isChatGptCookieUrl(currentUrl);
			const headers = new Headers(baseHeaders);
			const cookieHeader = cloudflareCookies.requestHeader(currentUrl);
			if (cookieHeader) headers.set("cookie", cookieHeader);
			const response = await fetch(currentUrl, {
				...(method ? { method } : {}),
				headers,
				...(body === undefined ? {} : { body }),
				...(options.signal ? { signal: options.signal } : {}),
				...(dispatcher ? { dispatcher } : {}),
				redirect: chatGptRequest ? "manual" : "follow",
			});
			if (chatGptRequest)
				cloudflareCookies.storeResponse(
					currentUrl,
					response.headers.getSetCookie(),
				);
			const location = redirectLocation(
				response.status,
				response.headers.get("location"),
			);
			if (!location || !chatGptRequest) {
				return {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers as unknown as Headers,
					text: await readBoundedText(
						response,
						options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
					),
				};
			}
			if (redirects >= MAX_REDIRECTS) {
				await response.body?.cancel();
				throw new Error(
					"Codex tool request exceeded " + MAX_REDIRECTS + " redirects",
				);
			}
			const nextUrl = new URL(location, currentUrl);
			if (!isChatGptCookieUrl(nextUrl)) {
				await response.body?.cancel();
				throw new Error(
					"Codex tool request refused redirect outside ChatGPT: " +
						nextUrl.origin,
				);
			}
			if (nextUrl.origin !== currentUrl.origin) {
				baseHeaders.delete("authorization");
				baseHeaders.delete("chatgpt-account-id");
			}
			if (
				response.status === 303 ||
				((response.status === 301 || response.status === 302) &&
					method?.toUpperCase() === "POST")
			) {
				method = "GET";
				body = undefined;
				baseHeaders.delete("content-type");
			}
			await response.body?.cancel();
			currentUrl = nextUrl;
		}
	} finally {
		await dispatcher?.close();
	}
}

function redirectLocation(
	status: number,
	location: string | null,
): string | undefined {
	return location && [301, 302, 303, 307, 308].includes(status)
		? location
		: undefined;
}

async function readBoundedText(
	response: Awaited<ReturnType<typeof fetch>>,
	maxBytes: number,
): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await response.body?.cancel();
		throw new Error("Codex tool response exceeded " + maxBytes + " bytes");
	}
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let text = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new Error("Codex tool response exceeded " + maxBytes + " bytes");
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}
