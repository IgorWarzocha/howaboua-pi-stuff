import type { CodexConversionConfig } from "./config.ts";

export type CodexCacheKeepaliveStrategy = "generated-current";

export interface CodexCacheKeepalivePlan {
	strategy: CodexCacheKeepaliveStrategy;
	intervalMs: number;
	maxOperations?: number | undefined;
}

export const LUNA_CACHE_KEEPALIVE_INTERVAL_MS = 2.5 * 60 * 1_000;
export const SOL_TERRA_CACHE_KEEPALIVE_INTERVAL_MS = 25 * 60 * 1_000;

export function resolveCodexCacheKeepalivePlan(
	modelId: string | undefined,
	config: Pick<CodexConversionConfig["openai"], "cacheKeepalive" | "lunaCacheKeepaliveMinutes">,
): CodexCacheKeepalivePlan | undefined {
	if (modelId === "gpt-5.6-luna") {
		if (config.lunaCacheKeepaliveMinutes === 0) return undefined;
		return {
			strategy: "generated-current",
			intervalMs: LUNA_CACHE_KEEPALIVE_INTERVAL_MS,
			maxOperations: config.lunaCacheKeepaliveMinutes / 2.5,
		};
	}
	if ((modelId === "gpt-5.6-sol" || modelId === "gpt-5.6-terra") && config.cacheKeepalive) {
		return {
			strategy: "generated-current",
			intervalMs: SOL_TERRA_CACHE_KEEPALIVE_INTERVAL_MS,
		};
	}
	return undefined;
}

export function hasCodexCacheKeepalivePlanChanged(
	modelId: string | undefined,
	previous: CodexConversionConfig["openai"],
	next: CodexConversionConfig["openai"],
): boolean {
	const previousPlan = resolveCodexCacheKeepalivePlan(modelId, previous);
	const nextPlan = resolveCodexCacheKeepalivePlan(modelId, next);
	return previousPlan?.strategy !== nextPlan?.strategy
		|| previousPlan?.intervalMs !== nextPlan?.intervalMs
		|| previousPlan?.maxOperations !== nextPlan?.maxOperations;
}
