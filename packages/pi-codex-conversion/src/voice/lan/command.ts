import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CodexLanVoiceServerController } from "./controller.ts";
import {
	isVoiceRequestId,
	writeLanReceipt,
	type LanReceipt,
} from "./receipt.ts";

const connections = new WeakMap<
	CodexLanVoiceServerController,
	{
		sessionId: string;
		requests: Map<string, Promise<LanReceipt>>;
		pending: boolean;
	}
>();
// Never evict a connect: forgetting it would permit another browser start.
const MAX_REQUESTS = 256;
const USAGE =
	"Usage: /codex voice server ensure|status [UUIDv4], or connect <browser-route> <UUIDv4> [url]";

/** Ensure/status never start a call. Connect owns one non-retried browser attempt. */
export async function runLanVoiceCommand(
	args: string,
	ctx: ExtensionCommandContext,
	lanVoice: CodexLanVoiceServerController,
	agentDir: string,
): Promise<void> {
	const [action, ...tokens] = args.trim().split(/\s+/);
	if (action !== "ensure" && action !== "status" && action !== "connect") {
		ctx.ui.notify(USAGE, "warning");
		return;
	}
	const [requestId, extra] =
		action === "connect"
			? [tokens[1], tokens.slice(3)]
			: [tokens[0], tokens.slice(1)];
	const browserRoute = action === "connect" ? tokens[0] : undefined;
	const sessionId = ctx.sessionManager.getSessionId();
	let session = connections.get(lanVoice);
	if (session?.sessionId !== sessionId) {
		session = { sessionId, requests: new Map(), pending: false };
		connections.set(lanVoice, session);
	}
	const key =
		action === "connect" && requestId && isVoiceRequestId(requestId)
			? requestId.toLowerCase()
			: undefined;
	const previous = key ? session.requests.get(key) : undefined;
	const execute = async (): Promise<LanReceipt> => {
		let failure: string | undefined;
		let browser: Partial<
			Pick<
				LanReceipt,
				"browserStatus" | "browserError" | "browserUrl" | "browserRefId"
			>
		> = {};
		let reserved = false;
		try {
			if (requestId && !isVoiceRequestId(requestId))
				throw new Error("Use a UUID v4 request ID");
			if (extra.length) throw new Error(USAGE);
			if (action === "connect") {
				if (!requestId || !browserRoute) throw new Error(USAGE);
				if (session.requests.size >= MAX_REQUESTS)
					throw new Error(
						"Voice request limit reached for this Pi session. Start a new session before submitting another request",
					);
				if (
					session.pending ||
					lanVoice.status().browserAttached ||
					lanVoice.hasActiveVoice()
				)
					throw new Error(
						"Voice is already active or connecting. Stop it before connecting another browser",
					);
				session.pending = reserved = true;
			}
			if (action !== "status") {
				if (ctx.mode !== "tui")
					throw new Error("LAN voice server requires interactive TUI mode");
				await lanVoice.setEnabled(true, ctx);
			}
			if (action === "connect" && browserRoute) {
				if (ctx.sessionManager.getSessionId() !== sessionId)
					throw new Error(
						"Pi session changed before the browser connection. Run connect from the selected session",
					);
				if (lanVoice.status().browserAttached || lanVoice.hasActiveVoice())
					throw new Error(
						"Voice became active before the browser connection. No new browser was opened",
					);
				const { connectLanVoiceBrowser } = await import("./browser-start.ts");
				const result = await connectLanVoiceBrowser({
					route: browserRoute,
					urls: lanVoice.status().urls,
					...(tokens[2] ? { url: tokens[2] } : {}),
					...(ctx.signal ? { signal: ctx.signal } : {}),
				});
				browser = {
					browserStatus: result.state,
					browserUrl: result.url,
					...(result.refId ? { browserRefId: result.refId } : {}),
				};
				if (result.state !== "listening") {
					failure =
						result.detail || result.status || `Browser voice ${result.state}`;
					browser.browserError = failure;
				}
			}
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
			if (action === "connect")
				browser = { browserStatus: "error", browserError: failure };
		} finally {
			if (reserved) session.pending = false;
		}
		const state = lanVoice.status();
		return {
			version: 1,
			requestId: requestId ?? "",
			action,
			sessionId,
			terminalId: process.env["HC_TERMINAL_ID"] ?? null,
			provider: "codex",
			status: failure ? "error" : state.running ? "running" : "stopped",
			...state,
			...(browserRoute ? { browserRoute } : {}),
			...browser,
			...(failure ? { error: failure } : {}),
		};
	};
	const pending = previous ?? execute();
	if (key && !previous && session.requests.size < MAX_REQUESTS)
		session.requests.set(key, pending);
	const receipt = { ...(await pending), requestId: requestId ?? "" };
	if (requestId && isVoiceRequestId(requestId)) {
		try {
			await writeLanReceipt(agentDir, receipt);
		} catch (error) {
			ctx.ui.notify(
				`Voice receipt could not be written: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
		return;
	}
	ctx.ui.notify(
		receipt.error ??
			(receipt.running
				? `LAN voice is running:\n${receipt.urls.join("\n")}`
				: "LAN voice server is stopped"),
		receipt.error ? "error" : "info",
	);
}
