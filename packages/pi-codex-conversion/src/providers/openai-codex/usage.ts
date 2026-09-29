import { calculateCost, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { CodexPrewarmUsage, ServiceTier } from "./types.ts";

function getServiceTierCostMultiplier(model: Model<Api>, serviceTier: ServiceTier): number {
	switch (serviceTier) {
		case "flex":
			return 0.5;
		case "priority":
		case "fast":
			return model.id === "gpt-5.5" ? 2.5 : 2;
		default:
			return 1;
	}
}

export function applyServiceTierPricing(usage: AssistantMessage["usage"], serviceTier: ServiceTier, model: Model<Api>): void {
	const multiplier = getServiceTierCostMultiplier(model, serviceTier);
	if (multiplier === 1) return;
	usage.cost.input *= multiplier;
	usage.cost.output *= multiplier;
	usage.cost.cacheRead *= multiplier;
	usage.cost.cacheWrite *= multiplier;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

export function resolveCodexServiceTier(responseServiceTier: ServiceTier, requestServiceTier: ServiceTier): ServiceTier {
	if (responseServiceTier === "default" && (requestServiceTier === "flex" || requestServiceTier === "priority")) {
		return requestServiceTier;
	}
	return responseServiceTier ?? requestServiceTier;
}

export function finalizeUsage(output: AssistantMessage): void {
	output.usage.cost.total = output.usage.cost.input + output.usage.cost.output + output.usage.cost.cacheRead + output.usage.cost.cacheWrite;
}

export function priceGeneratedPrewarm(model: Model<Api>, prewarm: CodexPrewarmUsage, tier: ServiceTier): AssistantMessage["usage"] {
	const usage = {
		input: prewarm.inputTokens, cacheRead: prewarm.cachedInputTokens, cacheWrite: prewarm.cacheWriteInputTokens,
		output: prewarm.outputTokens ?? 0,
		totalTokens: prewarm.inputTokens + prewarm.cachedInputTokens + prewarm.cacheWriteInputTokens + (prewarm.outputTokens ?? 0),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, usage);
	applyServiceTierPricing(usage, tier, model);
	return usage;
}
