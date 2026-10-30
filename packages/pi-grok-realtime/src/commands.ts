import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { PiActivity } from "./activity.ts";
import {
	MODELS,
	normalizeConfig,
	readConfig,
	SPEEDS,
	VOICES,
	writeConfig,
} from "./config.ts";
import type { GrokControls } from "./controls.ts";
import { validateAccess } from "./credentials.ts";
import { type BrowserReceipt, connectBrowserVoice } from "./lan/connect.ts";
import {
	isVoiceRequestId,
	type LanReceipt,
	writeLanReceipt,
} from "./lan/receipt.ts";
import type { startLan } from "./lan/server.ts";
import { openSettings } from "./settings.ts";

const MAX_CONNECT_REQUESTS = 256;

export function createGrokCommands(
	pi: ExtensionAPI,
	controls: GrokControls,
	activity: PiActivity,
	getActivity: () => ReturnType<PiActivity["snapshot"]>,
) {
	const { voice, dictation } = controls;
	let lan: Awaited<ReturnType<typeof startLan>> | undefined;
	let lanOperation = Promise.resolve();
	let pendingLanStarts = 0;
	let lanStartup = new AbortController();
	const cancelLanStartup = () => {
		lanStartup.abort(new Error("Browser voice startup cancelled"));
		lanStartup = new AbortController();
		controls.cancelStartup();
	};
	const connectReceipts = new Map<string, LanReceipt>();
	controls.onChange = activity.onChange = () => lan?.publish();
	const stopLan = async () => {
		controls.cancelStartup();
		const current = lan;
		lan = undefined;
		await current?.close();
	};
	const runLan = (action: () => Promise<void>) => {
		const result = lanOperation.then(action, action);
		lanOperation = result.catch(() => {});
		return result;
	};
	const command: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description: "Grok realtime voice and browser control",
		getArgumentCompletions: (prefix) =>
			[
				"local",
				"server",
				"server ensure",
				"server status",
				"server connect",
				"dictate",
				"cancel",
				"stop",
				"mute",
			]
				.filter((action) => action.startsWith(prefix))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const [command, operation, first, ...rest] = args.trim().split(/\s+/);
			const browserRoute = operation === "connect" ? first : undefined;
			const requestId = operation === "connect" ? rest[0] : first;
			const explicitUrl = operation === "connect" ? rest[1] : undefined;
			const extra = operation === "connect" ? rest.slice(2) : rest;
			let browser: BrowserReceipt = browserRoute
				? { browserRoute, browserStatus: "error" }
				: {};
			const serverAction =
				command === "server" &&
				(operation === "ensure" ||
					operation === "status" ||
					operation === "connect")
					? operation
					: undefined;
			const receipt = async (error?: unknown) => {
				const result: LanReceipt = {
					version: 1,
					requestId: requestId ?? "",
					action: serverAction ?? "status",
					sessionId: ctx.sessionManager.getSessionId(),
					terminalId: process.env["HC_TERMINAL_ID"] ?? null,
					provider: "grok",
					status: error !== undefined ? "error" : lan ? "running" : "stopped",
					running: !!lan,
					urls: lan ? [...lan.urls] : [],
					browserAttached: lan?.browserAttached() ?? false,
					...browser,
					...(error !== undefined
						? { error: error instanceof Error ? error.message : String(error) }
						: {}),
				};
				if (requestId && isVoiceRequestId(requestId)) {
					if (
						serverAction === "connect" &&
						connectReceipts.size < MAX_CONNECT_REQUESTS
					)
						connectReceipts.set(requestId.toLowerCase(), result);
					await writeLanReceipt(getAgentDir(), result);
				} else
					ctx.ui.notify(
						error
							? (result.error ?? "LAN server failed")
							: lan
								? `Grok browser control:\n${lan.urls.join("\n")}`
								: "Grok browser control is stopped",
						error ? "error" : "info",
					);
			};
			try {
				if (
					serverAction &&
					(extra.length ||
						(requestId && !isVoiceRequestId(requestId)) ||
						(serverAction === "connect" && (!browserRoute || !requestId)))
				)
					throw new Error(
						"Usage: /grok server ensure|status [UUID-v4-request-id], or /grok server connect <browser-route> <UUID-v4-request-id> [server-url]",
					);
				const action = args.trim();
				if (!action) {
					await openSettings(ctx, pi);
					return;
				}
				if (action === "stop") {
					cancelLanStartup();
					await runLan(stopLan);
					await controls.stop();
					return;
				}
				if (action === "dictate") {
					await controls.toggleDictation(ctx);
					return;
				}
				if (action === "cancel") {
					await controls.cancelDictation();
					return;
				}
				if (action === "mute") {
					voice.mute(!voice.state().muted);
					return;
				}
				if (action === "local") {
					await controls.startVoice(ctx);
					return;
				}
				if (action === "server" || serverAction) {
					// A toggle during bind disables the pending listener, not its successor.
					const disable = !serverAction && Boolean(lan || pendingLanStarts);
					if (disable) cancelLanStartup();
					// Capture before enqueue: shutdown must invalidate queued starts too.
					const signal = lanStartup.signal;
					const startsLan = !disable && serverAction !== "status";
					if (startsLan) pendingLanStarts++;
					await runLan(async () => {
						try {
							signal.throwIfAborted();
							if (serverAction === "connect" && requestId) {
								const previous = connectReceipts.get(requestId.toLowerCase());
								if (previous) {
									await writeLanReceipt(getAgentDir(), {
										...previous,
										requestId,
									});
									return;
								}
								// Never evict a connect: forgetting it would permit another browser start.
								if (connectReceipts.size >= MAX_CONNECT_REQUESTS)
									throw new Error(
										"Voice request limit reached for this Pi session. Start a new session before submitting another request",
									);
								if (
									lan?.browserAttached() ||
									!["idle", "error"].includes(voice.state().status) ||
									controls.preparing ||
									["connecting", "recording", "finishing"].includes(
										dictation.state().status,
									)
								)
									throw new Error(
										"Voice or a browser is already active. Inspect the existing call before connecting another browser",
									);
							}
							if (
								serverAction === "status" ||
								(serverAction === "ensure" && lan)
							) {
								await receipt();
								return;
							}
							if (disable) {
								await stopLan();
								return;
							}
							if (!lan) {
								const { startLan } = await import("./lan/server.ts");
								signal.throwIfAborted();
								const started = await startLan({
									agentDir: getAgentDir(),
									port: readConfig().port,
									callbacks: {
										cancelStartup: () => controls.cancelStartup(),
										start: (audio) => controls.startVoice(ctx, audio),
										startDictation: (audio) =>
											controls.startDictation(ctx, audio),
										finishDictation: () => controls.finishDictation(),
										cancelDictation: () => controls.cancelDictation(),
										stop: () => controls.stop(),
										stopCall: () => controls.stopCall(),
										theme: () => ctx.ui.theme,
										send: (text) => {
											activity.working();
											void voice
												.sendText(ctx, text)
												.catch((error) =>
													ctx.ui.notify(
														error instanceof Error
															? error.message
															: String(error),
														"error",
													),
												);
										},
										state: () => ({
											...voice.state(),
											activity: getActivity(),
											dictation: dictation.state(),
										}),
										mute: (muted) => voice.mute(muted),
										settings: () => ({
											config: readConfig(),
											voices: VOICES,
											models: MODELS,
											contextModels: [
												"current",
												"off",
												...ctx.modelRegistry
													.getAvailable()
													.map((model) => `${model.provider}/${model.id}`),
											],
											speeds: SPEEDS,
										}),
										configure: (patch) => {
											const config = normalizeConfig(patch, readConfig());
											if (
												patch &&
												typeof patch === "object" &&
												Object.hasOwn(patch, "access")
											)
												validateAccess(ctx, config.access);
											writeConfig(config);
											return config;
										},
									},
								});
								if (signal.aborted) {
									await started.close();
									signal.throwIfAborted();
								}
								lan = started;
							}
							if (serverAction === "connect" && browserRoute) {
								browser = await connectBrowserVoice(
									browserRoute,
									lan.urls,
									explicitUrl,
									signal,
								);
								if (browser.browserStatus !== "listening")
									throw new Error(
										browser.browserError ??
											"Browser voice did not reach listening",
									);
							}
							if (serverAction) await receipt();
							else
								ctx.ui.notify(
									`Grok browser control:\n${lan.urls.join("\n")}\nTrusted LAN only; accept the local certificate on first visit.`,
									"info",
								);
						} catch (error) {
							if (serverAction === "connect")
								browser = {
									...browser,
									browserError:
										error instanceof Error ? error.message : String(error),
								};
							if (serverAction && requestId) await receipt(error);
							else throw error;
						}
					}).finally(() => {
						if (startsLan) pendingLanStarts--;
					});
					return;
				}
				ctx.ui.notify(
					"Usage: /grok [local|server|dictate|cancel|stop|mute]",
					"warning",
				);
			} catch (error) {
				if (serverAction && requestId && isVoiceRequestId(requestId)) {
					try {
						await receipt(error);
						return;
					} catch (receiptError) {
						ctx.ui.notify(
							`Voice receipt could not be written: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}`,
							"error",
						);
						return;
					}
				}
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	};
	const cleanup = async () => {
		cancelLanStartup();
		try {
			await runLan(async () => {
				await stopLan();
				connectReceipts.clear();
			});
		} finally {
			await controls.stop();
			activity.reset();
		}
	};
	return { command, cleanup };
}
