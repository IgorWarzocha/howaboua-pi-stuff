import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { Model } from "@earendil-works/pi-ai";
import { DEFAULT_CODEX_BASE_URL } from "./constants.ts";
import { CODEX_RESERVE_MODEL } from "../../codex-usage/reserve-policy.ts";

const GPT_56_PRODUCTION_CONTEXT_WINDOW = 272_000;

const UNKNOWN_SUBSCRIPTION_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

const SUPPLEMENTAL_MODELS: Model<"openai-codex-responses">[] = [
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
		compat: { supportsOpenAIGrammarTools: true, supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsToolSearch: true },
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
		compat: { supportsOpenAIGrammarTools: true, supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsToolSearch: true },
	},
];

export function openAICodexProviderModels(): Model<"openai-codex-responses">[] {
	const models = [...getBuiltinModels("openai-codex")];
	const luna = models.find(({ id }) => id === "gpt-5.6-luna");
	// Reserve is the backend-authorized Luna route, not an ordinary selectable model.
	// Keep it resolvable for session resume; provider availability hides it from the picker.
	if (luna && !models.some(({ id }) => id === CODEX_RESERVE_MODEL)) {
		models.push({ ...luna, id: CODEX_RESERVE_MODEL, name: "Luna Reserve", cost: UNKNOWN_SUBSCRIPTION_COST, contextWindow: GPT_56_PRODUCTION_CONTEXT_WINDOW });
	}
	const existing = new Set(models.map(({ id }) => id));
	return [...models, ...SUPPLEMENTAL_MODELS.filter(({ id }) => !existing.has(id))].map((model) => {
		// Codex advertises low and above, not the API models' reasoning-off option.
		if (["gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna"].includes(model.id)) {
			return { ...model, thinkingLevelMap: { ...model.thinkingLevelMap, off: null } };
		}
		return /^gpt-5\.6-(?:luna|terra|sol)$/i.test(model.id) && model.contextWindow > GPT_56_PRODUCTION_CONTEXT_WINDOW
			? { ...model, contextWindow: GPT_56_PRODUCTION_CONTEXT_WINDOW }
			: model;
	});
}
