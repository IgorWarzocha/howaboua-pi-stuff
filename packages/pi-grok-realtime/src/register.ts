import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { PiActivity } from "./activity.ts";
import {
	MODELS,
	normalizeConfig,
	readConfig,
	SPEEDS,
	VOICES,
	writeConfig,
} from "./config.ts";
import { GrokControls } from "./controls.ts";
import { validateAccess } from "./credentials.ts";
import { registerVoiceHandoff } from "./handoff.ts";
import { isRecord } from "./handoff-wire.ts";
import { type BrowserReceipt, connectBrowserVoice } from "./lan/connect.ts";
import {
	isVoiceRequestId,
	type LanReceipt,
	writeLanReceipt,
} from "./lan/receipt.ts";
import type { startLan } from "./lan/server.ts";
import { openSettings } from "./settings.ts";

const MAX_CONNECT_REQUESTS = 256;

export function registerGrokRealtime(pi: ExtensionAPI): void {
	const controls = new GrokControls(pi);
	const { voice, dictation } = controls;
	const activity = new PiActivity();
	let transferredActivity: ReturnType<PiActivity["snapshot"]> = {
		status: "idle",
		text: "",
	};
	const transferredPrompts: string[] = [];
	voice.onTransferredEvent = (event, data) => {
		if (event === "handoff_started") {
			transferredPrompts.length = 0;
			transferredActivity = { status: "idle", text: "" };
		} else if (event === "agent_start")
			transferredActivity = { status: "working", text: "" };
		else if (event === "agent_settled")
			transferredActivity = {
				...transferredActivity,
				status: transferredActivity.text ? "settled" : "idle",
			};
		else if (event === "ui_prompt_start") {
			transferredPrompts.push(
				isRecord(data) && typeof data["title"] === "string"
					? data["title"]
					: "Pi is waiting for your input in the terminal",
			);
		} else if (event === "ui_prompt_end") transferredPrompts.pop();
		else if (
			(event === "message_update" || event === "message_end") &&
			isRecord(data)
		) {
			const message = data["message"];
			if (
				isRecord(message) &&
				message["role"] === "assistant" &&
				Array.isArray(message["content"])
			) {
				const text = message["content"]
					.flatMap((part: unknown) =>
						isRecord(part) &&
						part["type"] === "text" &&
						typeof part["text"] === "string"
							? [part["text"]]
							: [],
					)
					.join("\n");
				if (text.trim()) transferredActivity = { ...transferredActivity, text };
			}
		}
	};
	registerVoiceHandoff({
		pi,
		voice,
		getConfig: readConfig,
		priority: () => 30,
		isBusy: () =>
			controls.preparing ||
			["connecting", "recording", "finishing"].includes(
				dictation.state().status,
			),
	});
	let lan: Awaited<ReturnType<typeof startLan>> | undefined;
	let lanOperation = Promise.resolve();
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
	pi.registerEntryRenderer<{ role: "user" | "assistant"; text: string }>(
		"grok-realtime-transcript",
		(entry, _options, theme) => {
			const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
			const label =
				entry.data?.role === "user" ? "You said · Grok voice" : "Grok voice";
			box.addChild(
				new Text(
					`${theme.bold(theme.fg("customMessageLabel", label))}\n${theme.fg("customMessageText", entry.data?.text ?? "")}`,
					0,
					0,
				),
			);
			return box;
		},
	);
	pi.registerEntryRenderer<{ text: string }>(
		"grok-realtime-context",
		(entry, _options, theme) => {
			const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
			box.addChild(
				new Text(
					`${theme.bold(theme.fg("customMessageLabel", "Grok voice context"))}\n${theme.fg("customMessageText", entry.data?.text ?? "")}`,
					0,
					0,
				),
			);
			return box;
		},
	);
	pi.registerEntryRenderer<{ request: string }>(
		"grok-realtime-delegation",
		(_entry, _options, theme) => {
			const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
			box.addChild(
				new Text(theme.bold(theme.fg("customMessageLabel", "Grok → Pi")), 0, 0),
			);
			return box;
		},
	);
	pi.registerEntryRenderer<{ name: string; args: Record<string, unknown> }>(
		"grok-realtime-native-tool",
		(entry, options, theme) => {
			const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
			const args = entry.data?.args ?? {};
			const query = typeof args["query"] === "string" ? args["query"] : "";
			box.addChild(
				new Text(
					`${theme.bold(theme.fg("customMessageLabel", "Grok → Web search"))}\n${query}\n${theme.fg("dim", "Reported by xAI; results not exposed")}${options.expanded ? `\n${JSON.stringify(args, null, 2)}` : ""}`,
					0,
					0,
				),
			);
			return box;
		},
	);
	const shortcuts = readConfig();
	for (const [key, description, handler] of [
		[
			shortcuts.voiceShortcut,
			"Toggle Grok voice",
			(ctx: ExtensionContext) => controls.toggleVoice(ctx),
		],
		[
			shortcuts.dictationShortcut,
			"Toggle Grok dictation into the editor",
			(ctx: ExtensionContext) => controls.toggleDictation(ctx),
		],
	] as const) {
		if (key)
			pi.registerShortcut(key, {
				description,
				handler: async (ctx) => {
					try {
						await handler(ctx);
					} catch (error) {
						ctx.ui.notify(
							error instanceof Error ? error.message : String(error),
							"error",
						);
					}
				},
			});
	}
	pi.registerCommand("grok", {
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
					await runLan(async () => {
						try {
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
							if (lan && !serverAction) {
								await stopLan();
								return;
							}
							if (!lan) {
								const { startLan } = await import("./lan/server.ts");
								lan = await startLan({
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
											activity:
												voice.state().status === "transferred"
													? {
															...transferredActivity,
															...(transferredPrompts.length
																? {
																		status: "waiting",
																		prompt:
																			transferredPrompts.at(-1) ??
																			"Pi is waiting for your input in the terminal",
																	}
																: {}),
														}
													: activity.snapshot(),
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
							}
							if (serverAction === "connect" && browserRoute) {
								browser = await connectBrowserVoice(
									browserRoute,
									lan.urls,
									explicitUrl,
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
	});
	pi.on("input", async (event) => {
		if (event.source !== "extension") voice.input(event.text);
	});
	pi.on("agent_start", async () => {
		voice.working();
		activity.working();
	});
	pi.on("ui_prompt_start", async (event) => activity.waiting(event.title));
	pi.on("ui_prompt_end", async () => activity.promptEnded());
	pi.on("message_start", async (event) => {
		if (event.message.role === "assistant") voice.messageStarted();
	});
	pi.on("message_update", async (event) => {
		if (event.message.role === "assistant") {
			voice.stream(event.message);
			activity.message(event.message);
		}
	});
	pi.on("message_end", async (event) => {
		if (event.message.role === "assistant") {
			voice.message(event.message);
			activity.message(event.message);
		}
	});
	pi.on("agent_settled", async () => {
		voice.settled();
		activity.settled();
	});
	pi.on("session_compact", async (_event, ctx) => voice.compacted(ctx));
	const cleanup = async () => {
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
	pi.on("session_start", cleanup);
	pi.on("session_shutdown", cleanup);
}
