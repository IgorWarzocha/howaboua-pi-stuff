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
import type { startLan } from "./lan/server.ts";
import { openSettings } from "./settings.ts";

export function registerGrokRealtime(pi: ExtensionAPI): void {
	const controls = new GrokControls(pi);
	const { voice, dictation } = controls;
	const activity = new PiActivity();
	let lan: Awaited<ReturnType<typeof startLan>> | undefined;
	let lanOperation = Promise.resolve();
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
			["local", "server", "dictate", "cancel", "stop", "mute"]
				.filter((action) => action.startsWith(prefix))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			try {
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
				if (action === "server") {
					await runLan(async () => {
						if (lan) {
							await stopLan();
							return;
						}
						const { startLan } = await import("./lan/server.ts");
						lan = await startLan({
							agentDir: getAgentDir(),
							port: readConfig().port,
							callbacks: {
								cancelStartup: () => controls.cancelStartup(),
								start: (audio) => controls.startVoice(ctx, audio),
								startDictation: (audio) => controls.startDictation(ctx, audio),
								finishDictation: () => controls.finishDictation(),
								cancelDictation: () => controls.cancelDictation(),
								stop: () => controls.stop(),
								theme: () => ctx.ui.theme,
								send: (text) => {
									activity.working();
									voice.input(text);
									pi.sendUserMessage(
										text,
										ctx.isIdle() ? undefined : { deliverAs: "steer" },
									);
								},
								state: () => ({
									...voice.state(),
									activity: activity.snapshot(),
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
						ctx.ui.notify(
							`Grok browser control:\n${lan.urls.join("\n")}\nTrusted LAN only; accept the local certificate on first visit.`,
							"info",
						);
					});
					return;
				}
				ctx.ui.notify(
					"Usage: /grok [local|server|dictate|cancel|stop|mute]",
					"warning",
				);
			} catch (error) {
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
			await runLan(stopLan);
		} finally {
			await controls.stop();
			activity.reset();
		}
	};
	pi.on("session_start", cleanup);
	pi.on("session_shutdown", cleanup);
}
