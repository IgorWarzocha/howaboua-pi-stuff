/**
 * Adds short slash commands for the three OpenAI Codex model variants.
 * The commands use Pi's model registry, so normal provider authentication and
 * model availability checks remain in charge.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MODELS = {
	sol: "gpt-5.6-sol",
	terra: "gpt-5.6-terra",
	luna: "gpt-5.6-luna",
} as const;

type Alias = keyof typeof MODELS;
type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";
const THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

function parseThinkingLevel(args: string): ThinkingLevel | undefined {
	const requested = args.trim().toLowerCase();
	if (requested === "") return DEFAULT_THINKING_LEVEL;
	return THINKING_LEVELS.has(requested as ThinkingLevel)
		? (requested as ThinkingLevel)
		: undefined;
}

export default function (pi: ExtensionAPI) {
	for (const alias of Object.keys(MODELS) as Alias[]) {
		pi.registerCommand(alias, {
			description: `Switch to GPT-5.6 ${alias.charAt(0).toUpperCase()}${alias.slice(1)}`,
			handler: async (args, ctx) => {
				const thinkingLevel = parseThinkingLevel(args);
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

				const alreadySelected =
					ctx.model?.provider === "openai-codex" && ctx.model.id === modelId;
				if (!alreadySelected) {
					const switched = await pi.setModel(model);
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
