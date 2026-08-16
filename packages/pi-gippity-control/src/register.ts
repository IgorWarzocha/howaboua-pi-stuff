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
import { registerLanRemoteCreateRenderers } from "./voice/lan/create.ts";
import { GippityRemoteApps } from "./voice/lan/remote-app.ts";
import { registerCodexVoiceRenderer } from "./voice/ui.ts";

export function registerGippityControl(pi: ExtensionAPI): void {
	registerCodexVoiceRenderer(pi);
	registerLanRemoteCreateRenderers(pi);
	const state: { config: GippityControlConfig } = {
		config: readGippityControlConfig(),
	};
	const voice = new CodexVoiceController(pi);
	const remoteApps = new GippityRemoteApps(pi);
	const lanVoice = new CodexLanVoiceServerController(
		pi,
		voice,
		() => {
			state.config = readGippityControlConfig();
			return state.config;
		},
		(text, ctx) =>
			pi.sendUserMessage(
				text,
				ctx.isIdle() ? undefined : { deliverAs: "steer" },
			),
		dirname(getGippityControlConfigPath()),
		remoteApps,
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
	pi.on("session_info_changed", async (event) => {
		lanVoice.piEvent("session_info_changed", event);
	});
	pi.on("message_end", async (event) => {
		if (event.message.role === "assistant") {
			voice.finishAgentMessage(
				event.message,
				state.config.voice.forwardReasoningSummaries,
			);
			lanVoice.assistantMessage(event.message);
		}
		lanVoice.piEvent("message_end", event);
	});
	pi.on("message_update", async (event) => {
		const update = event.assistantMessageEvent;
		if (update.type === "text_delta" && typeof update.delta === "string")
			voice.streamDelta(update.delta);
		lanVoice.piEvent("message_update", event);
	});
	pi.on("input", async (event) => {
		if (event.streamingBehavior === "steer" && event.source !== "extension")
			voice.mirrorPiSteer(event.text);
		lanVoice.piEvent("input", event);
	});
	pi.on("agent_start", async (event) => {
		voice.agentStarted();
		lanVoice.agentStarted();
		lanVoice.piEvent("agent_start", event);
	});
	pi.on("agent_settled", async (event) => {
		voice.settleTurn();
		lanVoice.agentSettled();
		lanVoice.piEvent("agent_settled", event);
	});
	pi.on("context", async (event) => ({
		messages: voice.filterContext(event.messages),
	}));
	pi.on("session_before_compact", async (event) => {
		if (event.reason !== "manual") voice.announceCompactionStart(event.reason);
	});
	pi.on("session_compact", async (event) => {
		voice.resetContextAnnouncements();
		lanVoice.piEvent("session_compact", event);
	});
	pi.on("agent_end", async (event) => lanVoice.piEvent("agent_end", event));
	pi.on("turn_start", async (event) => lanVoice.piEvent("turn_start", event));
	pi.on("turn_end", async (event) => lanVoice.piEvent("turn_end", event));
	pi.on("message_start", async (event) =>
		lanVoice.piEvent("message_start", event),
	);
	pi.on("tool_execution_start", async (event) =>
		lanVoice.piEvent("tool_execution_start", event),
	);
	pi.on("tool_execution_update", async (event) =>
		lanVoice.piEvent("tool_execution_update", event),
	);
	pi.on("tool_execution_end", async (event) =>
		lanVoice.piEvent("tool_execution_end", event),
	);
	pi.on("model_select", async (event) =>
		lanVoice.piEvent("model_select", event),
	);
	pi.on("thinking_level_select", async (event) =>
		lanVoice.piEvent("thinking_level_select", event),
	);
	pi.on("tool_call", async (event) => lanVoice.piEvent("tool_call", event));
	pi.on("tool_result", async (event) => lanVoice.piEvent("tool_result", event));
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
