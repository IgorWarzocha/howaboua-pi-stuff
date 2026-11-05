import {
	CONTEXT_REASONING,
	type GrokRealtimeConfig,
	MODELS,
	SPEEDS,
	VOICES,
} from "./config-file.ts";
export function grokSettingsSnapshot(
	config: GrokRealtimeConfig,
	models: { provider: string; modelId: string }[],
) {
	return {
		config,
		voices: VOICES,
		models: MODELS,
		contextModels: [
			"current",
			"off",
			...models.map((model) => `${model.provider}/${model.modelId}`),
		],
		speeds: SPEEDS,
		contextReasoningLevels: CONTEXT_REASONING,
	};
}
