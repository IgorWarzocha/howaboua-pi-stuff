/**
 * Adds short slash commands for OpenAI Codex model variants.
 * The commands use Pi's model registry, so normal provider authentication and
 * model availability checks remain in charge.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	ensureGptSwitcherConfig,
	type GptSwitcherConfig,
	readGptSwitcherConfig,
	type ShortcutAlias,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "./config.js";

const MODELS = {
	sol: { id: "gpt-6.2-sol", name: "GPT-6.2 Sol" },
	terra: { id: "gpt-6.1-terra", name: "GPT-6.1 Terra" },
	luna: { id: "gpt-6-luna", name: "GPT-6 Luna" },
	astra: { id: "gpt-6.2-astra", name: "GPT-6.2 Astra" },
} as const;

type Alias = keyof typeof MODELS & ShortcutAlias;

const SUPPLEMENTAL_MODELS: ProviderModelConfig[] = [
	{
		id: "gpt-6.2-sol",
		name: "GPT-6.2 Sol",
		contextWindow: 500_000,
		cost: {
			input: 2,
			output: 10,
			cacheRead: 0.1,
			cacheWrite: 2.5,
			tiers: [
				{
					inputTokensAbove: 272_000,
					input: 4,
					output: 15,
					cacheRead: 0.2,
					cacheWrite: 5,
				},
			],
		},
	},
	{
		id: "gpt-6.2-astra",
		name: "GPT-6.2 Astra",
		contextWindow: 272_000,
		cost: {
			input: 8,
			output: 40,
			cacheRead: 0.4,
			cacheWrite: 10,
			tiers: [
				{
					inputTokensAbove: 272_000,
					input: 16,
					output: 60,
					cacheRead: 0.8,
					cacheWrite: 20,
				},
			],
		},
	},
].map((model) => ({
	...model,
	api: "openai-codex-responses",
	reasoning: true,
	input: ["text", "image"],
	maxTokens: 128_000,
	thinkingLevelMap: { off: null, minimal: "low", xhigh: "xhigh", max: "max" },
	compat: {
		supportsOpenAIGrammarTools: true,
		supportsMidConvoSystemMessages: true,
		supportsAdditionalTools: true,
		supportsToolSearch: true,
	},
}));

function ensureShortcutModels(
	registry: ExtensionContext["modelRegistry"],
): void {
	const missing = SUPPLEMENTAL_MODELS.filter(
		({ id }) => !registry.find("openai-codex", id),
	);
	// Pi's config registration removes a native extension provider. Never replace
	// one: its catalogue, authentication and transport remain authoritative.
	if (!missing.length || registry.getRegisteredNativeProvider("openai-codex"))
		return;
	const models = [
		...registry.getAll(),
		...registry.getModelsOfType("image"),
		...registry.getModelsOfType("classifier"),
	].filter(({ provider }) => provider === "openai-codex");
	// A config model list replaces rather than appends. Preserve the complete
	// current catalogue and all existing auth/stream configuration.
	registry.registerProvider("openai-codex", {
		models: [...models, ...missing],
	});
}

function parseThinkingLevel(
	args: string,
	defaultThinkingLevel: ThinkingLevel,
): ThinkingLevel | undefined {
	const requested = args.trim().toLowerCase();
	if (requested === "") return defaultThinkingLevel;
	return THINKING_LEVELS.has(requested as ThinkingLevel)
		? (requested as ThinkingLevel)
		: undefined;
}

export default function (
	pi: ExtensionAPI,
	options: { getConfig?: () => GptSwitcherConfig } = {},
) {
	const getConfig = options.getConfig ?? readGptSwitcherConfig;
	if (!options.getConfig) ensureGptSwitcherConfig();

	pi.on("session_start", (_event, ctx) => {
		ensureShortcutModels(ctx.modelRegistry);
	});

	for (const alias of Object.keys(MODELS) as Alias[]) {
		const shortcut = MODELS[alias];
		pi.registerCommand(alias, {
			description: `Switch to ${shortcut.name}`,
			handler: async (args, ctx) => {
				const defaults = getConfig()[alias];
				const thinkingLevel = parseThinkingLevel(args, defaults.reasoning);
				if (!thinkingLevel) {
					ctx.ui.notify(
						`Usage: /${alias} [off|minimal|low|medium|high|xhigh|max]`,
						"error",
					);
					return;
				}

				const modelId = shortcut.id;
				ensureShortcutModels(ctx.modelRegistry);
				const model = ctx.modelRegistry.find("openai-codex", modelId);

				if (!model) {
					ctx.ui.notify(`Model unavailable: openai-codex/${modelId}`, "error");
					return;
				}

				const selectedModel = {
					...model,
					contextWindow: defaults.contextWindow,
				};
				const alreadySelected =
					ctx.model?.provider === "openai-codex" &&
					ctx.model.id === modelId &&
					ctx.model.contextWindow === defaults.contextWindow;
				if (!alreadySelected) {
					let switched: boolean;
					try {
						switched = await pi.setModel(selectedModel);
					} catch (error) {
						ctx.ui.notify(
							`Could not switch to ${model.name}: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
						return;
					}
					if (!switched) {
						ctx.ui.notify(
							`Could not switch to ${model.name}: no OpenAI Codex credentials`,
							"error",
						);
						return;
					}
				}

				pi.setThinkingLevel(thinkingLevel);
				ctx.ui.notify(
					`${alreadySelected ? "Using" : "Switched to"} ${model.name} (${pi.getThinkingLevel()})`,
					"info",
				);
			},
		});
	}
}
