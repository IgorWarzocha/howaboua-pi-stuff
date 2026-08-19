/**
 * Adds short slash commands for the three OpenAI Codex model variants.
 * The commands use Pi's model registry, so normal provider authentication and
 * model availability checks remain in charge.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ensureGptSwitcherConfig,
	type GptSwitcherConfig,
	readGptSwitcherConfig,
	type ShortcutAlias,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "./config.js";

const MODELS = {
	sol: "gpt-5.6-sol",
	terra: "gpt-5.6-terra",
	luna: "gpt-5.6-luna",
} as const;

type Alias = keyof typeof MODELS & ShortcutAlias;

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

	for (const alias of Object.keys(MODELS) as Alias[]) {
		pi.registerCommand(alias, {
			description: `Switch to GPT-5.6 ${alias.charAt(0).toUpperCase()}${alias.slice(1)}`,
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

				const modelId = MODELS[alias];
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
