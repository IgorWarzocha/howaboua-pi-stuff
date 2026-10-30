import {
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { PiActivity } from "./activity.ts";
import { createGrokCommands } from "./commands.ts";
import { readConfig } from "./config.ts";
import { GrokControls } from "./controls.ts";
import { registerVoiceHandoff } from "./handoff.ts";
import { isRecord } from "./handoff-wire.ts";

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
	const { command, cleanup } = createGrokCommands(pi, controls, activity, () =>
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
	);
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
	pi.registerCommand("grok", command);
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
	pi.on("session_start", cleanup);
	pi.on("session_shutdown", cleanup);
}
