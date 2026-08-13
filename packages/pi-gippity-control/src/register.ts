import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGippityCommand } from "./command.ts";
import type { GippityControlConfig } from "./config.ts";
import {
	getGippityControlConfigPath,
	readGippityControlConfig,
} from "./config-store.ts";
import {
	parseRealtimeVoicePrompt,
	REALTIME_VOICE_PROMPT_CHANNEL,
} from "./realtime-voice.ts";
import { CodexVoiceController } from "./voice/controller.ts";
import { createCodexVoiceControls } from "./voice/controls.ts";
import { CodexLanVoiceServerController } from "./voice/lan/controller.ts";
import { registerCodexVoiceRenderer } from "./voice/ui.ts";

export function registerGippityControl(pi: ExtensionAPI): void {
	registerCodexVoiceRenderer(pi);
	const state: { config: GippityControlConfig } = {
		config: readGippityControlConfig(),
	};
	const voice = new CodexVoiceController(pi);
	const lanVoice = new CodexLanVoiceServerController(
		voice,
		() => state.config,
		(text, ctx) =>
			pi.sendUserMessage(
				text,
				ctx.isIdle() ? undefined : { deliverAs: "steer" },
			),
		dirname(getGippityControlConfigPath()),
	);
	const voiceControls = createCodexVoiceControls({
		pi,
		state,
		voice,
		lanVoice,
	});
	registerGippityCommand({ pi, state, voiceControls, lanVoice });
	pi.events.on(REALTIME_VOICE_PROMPT_CHANNEL, (value) => {
		const report = parseRealtimeVoicePrompt(value);
		if (report) voice.setPrompt(report);
	});

	pi.on("session_start", async (_event, ctx) => {
		await lanVoice.stop(ctx);
		voice.resetContextAnnouncements();
		voice.resetSessionContext();
		state.config = readGippityControlConfig();
	});
	pi.on("message_end", async (event) => {
		if (event.message.role === "assistant") {
			voice.finishAgentMessage(
				event.message,
				state.config.voice.forwardReasoningSummaries,
			);
			lanVoice.assistantMessage(event.message);
		}
	});
	pi.on("message_update", async (event) => {
		const update = event.assistantMessageEvent;
		if (update.type === "text_delta" && typeof update.delta === "string")
			voice.streamDelta(update.delta);
	});
	pi.on("input", async (event) => {
		if (event.streamingBehavior === "steer" && event.source !== "extension")
			voice.mirrorPiSteer(event.text);
	});
	pi.on("agent_start", async () => {
		voice.agentStarted();
		lanVoice.agentStarted();
	});
	pi.on("agent_settled", async () => {
		voice.settleTurn();
		lanVoice.agentSettled();
	});
	pi.on("context", async (event) => ({
		messages: voice.filterContext(event.messages),
	}));
	pi.on("session_before_compact", async (event) => {
		if (event.reason !== "manual") voice.announceCompactionStart(event.reason);
	});
	pi.on("session_compact", async () => {
		voice.resetContextAnnouncements();
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		const failures: unknown[] = [];
		try {
			await lanVoice.stop(ctx);
		} catch (error) {
			failures.push(error);
		}
		try {
			await voice.stop({ announce: true });
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(failures, "GipPity shutdown failed");
	});
}
