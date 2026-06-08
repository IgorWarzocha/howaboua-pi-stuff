const EXACT_CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com", "chatgpt-staging.com"]);
const CHATGPT_HOST_SUFFIXES = [".chatgpt.com", ".chatgpt-staging.com"];
const CLOUDFLARE_COOKIE_NAMES = new Set([
	"__cf_bm",
	"__cflb",
	"__cfruid",
	"__cfseq",
	"__cfwaitingroom",
	"_cfuvid",
	"cf_clearance",
	"cf_ob_info",
	"cf_use_ob",
]);

const sharedCloudflareCookies = new Map<string, string>();

export function isAllowedChatGptHost(host: string): boolean {
	const normalized = host.toLowerCase();
	return EXACT_CHATGPT_HOSTS.has(normalized) || CHATGPT_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function isAllowedCloudflareCookieName(name: string): boolean {
	return CLOUDFLARE_COOKIE_NAMES.has(name) || name.startsWith("cf_chl_");
}

function isChatGptCookieUrl(url: URL): boolean {
	return url.protocol === "https:" && isAllowedChatGptHost(url.hostname);
}

function splitSetCookieHeader(header: string): string[] {
	const cookies: string[] = [];
	let start = 0;
	let inExpires = false;
	for (let index = 0; index < header.length; index++) {
		const char = header[index];
		if (char === ";") inExpires = false;
		if (char === "," && !inExpires) {
			cookies.push(header.slice(start, index).trim());
			start = index + 1;
			continue;
		}
		if (header.slice(index, index + 8).toLowerCase() === "expires=") inExpires = true;
	}
	cookies.push(header.slice(start).trim());
	return cookies.filter(Boolean);
}

function setCookieHeaders(headers: Headers): string[] {
	const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
	if (typeof getSetCookie === "function") return getSetCookie.call(headers);
	const header = headers.get("set-cookie");
	return header ? splitSetCookieHeader(header) : [];
}

export function storeChatGptCloudflareCookies(url: string, headers: Headers): void {
	const parsedUrl = new URL(url);
	if (!isChatGptCookieUrl(parsedUrl)) return;
	for (const setCookie of setCookieHeaders(headers)) {
		const [pair] = setCookie.split(";", 1);
		const [rawName, ...rawValue] = (pair ?? "").split("=");
		const name = rawName?.trim();
		const value = rawValue.join("=").trim();
		if (!name || !isAllowedCloudflareCookieName(name)) continue;
		if (!value) sharedCloudflareCookies.delete(name);
		else sharedCloudflareCookies.set(name, value);
	}
}

export function chatGptCloudflareCookieHeader(url: string): string | undefined {
	const parsedUrl = new URL(url);
	if (!isChatGptCookieUrl(parsedUrl) || sharedCloudflareCookies.size === 0) return undefined;
	const cookies = [...sharedCloudflareCookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
	return cookies || undefined;
}

export function attachChatGptCloudflareCookies(url: string, headers: Headers): void {
	const cookie = chatGptCloudflareCookieHeader(url);
	if (cookie) headers.set("Cookie", cookie);
}

export function clearChatGptCloudflareCookiesForTests(): void {
	sharedCloudflareCookies.clear();
}
