import type { GrokRealtimeConfig } from "../config.ts";
import { VOICE_TOOLS } from "../prompt.ts";
import type { GrokToolWireDefinition } from "../tools.ts";
export function sessionConfiguration(
	config: GrokRealtimeConfig,
	tools: readonly GrokToolWireDefinition[],
	instructions: string,
): Record<string, unknown> {
	return {
		instructions,
		voice: config.voice,
		tools: [
			...VOICE_TOOLS,
			...tools,
			...(config.webSearch ? [{ type: "web_search" }] : []),
		],
		tool_choice: "auto",
		reasoning: { effort: config.reasoning },
		audio: {
			input: {
				format: { type: "audio/pcm", rate: 24000 },
				...(config.language === "auto"
					? {}
					: { transcription: { language_hint: config.language } }),
			},
			output: {
				format: { type: "audio/pcm", rate: 24000 },
				speed: config.speed,
			},
		},
	};
}

export function effectiveSessionConfiguration(
	configuration: Record<string, unknown>,
	muted: boolean,
	piBusy: boolean,
	silenceSeconds: number,
): Record<string, unknown> {
	return {
		...configuration,
		turn_detection: {
			type: "server_vad",
			idle_timeout_ms:
				!muted && !piBusy && silenceSeconds ? silenceSeconds * 1000 : null,
		},
	};
}
