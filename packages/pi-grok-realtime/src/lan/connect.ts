import { hostname } from "node:os";
import type { LanReceipt } from "./receipt.ts";

export type BrowserReceipt = Pick<
	LanReceipt,
	| "browserRoute"
	| "browserStatus"
	| "browserError"
	| "browserUrl"
	| "browserRefId"
>;

export async function connectBrowserVoice(
	route: string,
	urls: string[],
	explicitUrl?: string,
	signal?: AbortSignal,
): Promise<BrowserReceipt> {
	let url: string | undefined;
	try {
		signal?.throwIfAborted();
		if (explicitUrl) {
			if (!urls.includes(explicitUrl))
				throw new Error(
					"Choose an explicit URL from the running server's URLs",
				);
			url = explicitUrl;
		} else {
			const names =
				route === "local" ? ["localhost", hostname()] : [hostname()];
			for (const name of names) {
				url = urls.find((value) => new URL(value).hostname === name);
				if (url) break;
			}
		}
		if (!url)
			throw new Error(
				`No server hostname URL is available. Choose a browser-reachable URL explicitly: ${urls.join(", ")}`,
			);
		if (
			route !== "local" &&
			["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
		)
			throw new Error("A remote browser needs a non-loopback server URL");
		const { startBrowserVoice } = await import(
			"@howaboua/pi-browser/voice-start"
		);
		signal?.throwIfAborted();
		const result = await startBrowserVoice({
			url,
			provider: "grok",
			...(signal ? { signal } : {}),
			...(route === "local" ? {} : { host: route }),
		});
		signal?.throwIfAborted();
		return {
			browserRoute: route,
			browserStatus: result.state,
			browserUrl: result.url,
			...(result.refId ? { browserRefId: result.refId } : {}),
			...(result.state !== "listening"
				? {
						browserError:
							result.detail ||
							result.status ||
							"Browser voice did not reach listening",
					}
				: {}),
		};
	} catch (error) {
		return {
			browserRoute: route,
			browserStatus: "error",
			...(url ? { browserUrl: url } : {}),
			browserError: error instanceof Error ? error.message : String(error),
		};
	}
}
