import {
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
	type BrowserReceipt,
	connectBrowserVoice,
} from "./voice/lan/connect.ts";
import type { CodexLanVoiceServerController } from "./voice/lan/controller.ts";
import {
	isVoiceRequestId,
	type LanReceipt,
	writeLanReceipt,
} from "./voice/lan/receipt.ts";

// Never evict a connect: forgetting it would permit a second browser start.
const MAX_REQUESTS = 256;

export async function handleServerCommand(
	args: string,
	ctx: ExtensionContext,
	lanVoice: CodexLanVoiceServerController,
	requests: Map<string, Promise<LanReceipt>>,
): Promise<boolean> {
	const [command, action, first, second, ...extra] = args.trim().split(/\s+/);
	const browserRoute = action === "connect" ? first : undefined;
	const requestId = action === "connect" ? second : first;
	const explicitUrl = action === "connect" ? extra[0] : undefined;
	if (command?.toLowerCase() !== "server" || !action) return false;
	if (
		(action !== "ensure" && action !== "status" && action !== "connect") ||
		(action === "connect" && (!browserRoute || !requestId)) ||
		(requestId && !isVoiceRequestId(requestId))
	) {
		ctx.ui.notify(
			"Usage: /gippity server ensure|status [UUID-v4] or server connect <browser-route> <UUID-v4> [listener-url]",
			"warning",
		);
		return true;
	}
	const key = action === "connect" ? requestId?.toLowerCase() : undefined;
	const previous = key ? requests.get(key) : undefined;
	const execute = async (): Promise<LanReceipt> => {
		let failure: string | undefined;
		let browser: BrowserReceipt = browserRoute
			? { browserRoute, browserStatus: "error" }
			: {};
		let server;
		try {
			if (key && requests.size >= MAX_REQUESTS)
				throw new Error(
					"Voice request limit reached for this Pi session. Start a new session before submitting another request",
				);
			if (
				action === "connect"
					? extra.length > 1
					: second !== undefined || extra.length > 0
			)
				throw new Error(
					"Usage: /gippity server ensure|status [UUID-v4] or server connect <browser-route> <UUID-v4> [listener-url]",
				);
			if (action !== "status" && ctx.mode !== "tui")
				throw new Error("GipPity requires interactive TUI mode");
			if (action === "connect" && browserRoute) {
				browser = await lanVoice.connectBrowser(ctx, (state, signal) =>
					connectBrowserVoice(browserRoute, state.urls, explicitUrl, signal),
				);
				if (browser.browserStatus !== "listening")
					failure =
						browser.browserError ?? "Browser voice did not reach listening";
			}
			server =
				action === "ensure"
					? await lanVoice.setEnabled(true, ctx)
					: await lanVoice.getStatus();
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
			if (browserRoute)
				browser = { ...browser, browserStatus: "error", browserError: failure };
			server = await lanVoice.getStatus();
		}
		return {
			version: 1,
			requestId: requestId ?? "",
			action,
			sessionId: ctx.sessionManager.getSessionId(),
			terminalId: process.env["HC_TERMINAL_ID"] ?? null,
			provider: "gippity",
			status:
				failure !== undefined
					? "error"
					: server.running
						? "running"
						: "stopped",
			...server,
			...browser,
			...(failure !== undefined ? { error: failure } : {}),
		};
	};
	const pending = previous ?? execute();
	if (key && !previous && requests.size < MAX_REQUESTS)
		requests.set(key, pending);
	const receipt = { ...(await pending), requestId: requestId ?? "" };
	if (requestId) {
		try {
			await writeLanReceipt(getAgentDir(), receipt);
		} catch (error) {
			ctx.ui.notify(
				`Voice receipt could not be written: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	} else {
		ctx.ui.notify(
			receipt.error ??
				(receipt.running
					? `GipPity control server is running:\n${receipt.urls.join("\n")}`
					: "GipPity control server is stopped"),
			receipt.error !== undefined ? "error" : "info",
		);
	}
	return true;
}
