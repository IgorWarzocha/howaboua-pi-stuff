import { hostname } from "node:os";
import type { BrowserVoiceStartResult } from "@howaboua/pi-browser/voice-start";

export async function connectLanVoiceBrowser(options: {
	route: string;
	urls: string[];
	url?: string;
	signal?: AbortSignal;
}): Promise<BrowserVoiceStartResult> {
	let url = options.url;
	if (url && !options.urls.includes(url)) throw new Error("Choose a URL returned by the LAN voice listener");
	if (!url) {
		if (options.route === "local") url = options.urls.find((value) => new URL(value).hostname === "localhost");
		url ??= options.urls.find((value) => new URL(value).hostname === hostname());
	}
	if (!url) throw new Error("No LAN voice URL matches this machine's hostname; supply a reachable URL returned by the listener");
	if (options.route !== "local" && /^(localhost|127(?:\.[0-9]+){3}|\[::1\])$/i.test(new URL(url).hostname))
		throw new Error("A remote browser needs a non-loopback LAN voice URL");
	const { startBrowserVoice } = await import("@howaboua/pi-browser/voice-start");
	return startBrowserVoice({ url, provider: "codex", ...(options.route === "local" ? {} : { host: options.route }), ...(options.signal ? { signal: options.signal } : {}) });
}
