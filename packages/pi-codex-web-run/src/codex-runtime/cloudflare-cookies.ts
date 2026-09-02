interface StoredCookie {
	name: string;
	value: string;
	domain: string;
	hostOnly: boolean;
	path: string;
	expiresAt?: number | undefined;
}

const EXACT_HOSTS = new Set([
	"chatgpt.com",
	"chat.openai.com",
	"chatgpt-staging.com",
]);
const EXACT_COOKIE_NAMES = new Set([
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

export function isChatGptCookieUrl(url: URL): boolean {
	return url.protocol === "https:" && isChatGptHost(url.hostname);
}

export class ChatGptCloudflareCookieStore {
	private readonly cookies = new Map<string, StoredCookie>();

	requestHeader(url: URL): string | undefined {
		if (!isChatGptCookieUrl(url)) return undefined;
		const now = Date.now();
		const matches: StoredCookie[] = [];
		for (const [key, cookie] of this.cookies) {
			if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
				this.cookies.delete(key);
				continue;
			}
			if (
				(cookie.hostOnly
					? url.hostname === cookie.domain
					: domainMatches(url.hostname, cookie.domain)) &&
				pathMatches(url.pathname, cookie.path)
			)
				matches.push(cookie);
		}
		matches.sort((left, right) => right.path.length - left.path.length);
		return matches.length
			? matches.map((cookie) => cookie.name + "=" + cookie.value).join("; ")
			: undefined;
	}

	storeResponse(url: URL, setCookieHeaders: readonly string[]): void {
		if (!isChatGptCookieUrl(url)) return;
		for (const header of setCookieHeaders) this.storeCookie(url, header);
	}

	private storeCookie(url: URL, header: string): void {
		const parts = header.split(";");
		const pair = parts.shift()?.trim();
		const separator = pair?.indexOf("=") ?? -1;
		if (!pair || separator <= 0) return;
		const name = pair.slice(0, separator).trim();
		if (!isAllowedCookieName(name)) return;
		const value = pair.slice(separator + 1).trim();
		let domain = url.hostname;
		let hostOnly = true;
		let path = "/";
		let expiresAt: number | undefined;
		for (const part of parts) {
			const [rawName, ...rawValue] = part.trim().split("=");
			const attribute = rawName?.toLowerCase();
			const attributeValue = rawValue.join("=").trim();
			if (attribute === "domain" && attributeValue) {
				const candidate = attributeValue.replace(/^\./, "").toLowerCase();
				if (
					!isAllowedCookieDomain(candidate) ||
					!domainMatches(url.hostname, candidate)
				)
					return;
				domain = candidate;
				hostOnly = false;
			} else if (attribute === "path" && attributeValue.startsWith("/")) {
				path = attributeValue;
			} else if (attribute === "max-age" && /^-?\d+$/.test(attributeValue)) {
				expiresAt = Date.now() + Number(attributeValue) * 1000;
			} else if (attribute === "expires" && attributeValue) {
				const parsed = Date.parse(attributeValue);
				if (Number.isFinite(parsed)) expiresAt = parsed;
			}
		}
		const key = [domain, path, name, hostOnly ? "host" : "domain"].join("\n");
		if (!value || (expiresAt !== undefined && expiresAt <= Date.now())) {
			this.cookies.delete(key);
			return;
		}
		this.cookies.set(key, { name, value, domain, hostOnly, path, expiresAt });
	}
}

function isChatGptHost(host: string): boolean {
	const normalized = host.toLowerCase();
	return (
		EXACT_HOSTS.has(normalized) ||
		normalized.endsWith(".chatgpt.com") ||
		normalized.endsWith(".chatgpt-staging.com")
	);
}

function isAllowedCookieName(name: string): boolean {
	return EXACT_COOKIE_NAMES.has(name) || name.startsWith("cf_chl_");
}

function isAllowedCookieDomain(domain: string): boolean {
	return domain === "openai.com" || isChatGptHost(domain);
}

function domainMatches(host: string, domain: string): boolean {
	return host === domain || host.endsWith("." + domain);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
	return (
		requestPath === cookiePath ||
		requestPath.startsWith(
			cookiePath.endsWith("/") ? cookiePath : cookiePath + "/",
		)
	);
}
