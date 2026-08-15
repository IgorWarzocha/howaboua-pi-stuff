import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { Api, Model } from "@earendil-works/pi-ai";
import { DEFAULT_CODEX_BASE_URL } from "./constants.ts";

const UNKNOWN_SUBSCRIPTION_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

const DAYBREAK_MODELS: Model<"openai-codex-responses">[] = [
	{
		id: "gpt-daybreak-blue-latest",
		name: "Daybreak Blue",
		api: "openai-codex-responses",
		provider: "openai-codex",
		baseUrl: DEFAULT_CODEX_BASE_URL,
		reasoning: true,
		input: ["text", "image"],
		cost: UNKNOWN_SUBSCRIPTION_COST,
		contextWindow: 272_000,
		maxTokens: 128_000,
		thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
		compat: { supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true },
	},
	{
		id: "gpt-daybreak-red-latest",
		name: "Daybreak Red",
		api: "openai-codex-responses",
		provider: "openai-codex",
		baseUrl: DEFAULT_CODEX_BASE_URL,
		reasoning: true,
		input: ["text", "image"],
		cost: UNKNOWN_SUBSCRIPTION_COST,
		contextWindow: 372_000,
		maxTokens: 128_000,
		thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
		compat: { supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true },
	},
];

export function openAICodexModelsWithDaybreak(): Model<Api>[] {
	const models: Model<Api>[] = getBuiltinModels("openai-codex");
	const existing = new Set(models.map(({ id }) => id));
	return [...models, ...DAYBREAK_MODELS.filter(({ id }) => !existing.has(id))];
}
