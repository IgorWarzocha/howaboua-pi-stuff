import type { CodexConversionConfig } from "./config.ts";
import { resolveCodexModelFamily } from "./fast-mode.ts";

export type CodexCacheKeepaliveStrategy = "generated-current";

export interface CodexCacheKeepalivePlan {
	strategy: CodexCacheKeepaliveStrategy;
	intervalMs: number;
	maxOperations?: number | undefined;
	maxDurationMs?: number | undefined;
}

export function resolveCodexCacheKeepalivePlan(
	modelId: string | undefined,
	config: Pick<
		CodexConversionConfig["openai"],
		| "cacheKeepalive"
		| "lunaCacheKeepaliveMinutes"
		| "lunaCacheKeepaliveIntervalMinutes"
		| "cacheKeepaliveIntervalMinutes"
	>,
): CodexCacheKeepalivePlan | undefined {
	const family = resolveCodexModelFamily(modelId);
	if (family === "luna") {
		if (config.lunaCacheKeepaliveMinutes === 0) return undefined;
		return {
			strategy: "generated-current",
			intervalMs: config.lunaCacheKeepaliveIntervalMinutes * 60_000,
			maxOperations: Math.floor(
				config.lunaCacheKeepaliveMinutes /
					config.lunaCacheKeepaliveIntervalMinutes,
			),
			maxDurationMs: config.lunaCacheKeepaliveMinutes * 60_000,
		};
	}
	if (
		(family === "astra" || family === "sol" || family === "terra") &&
		config.cacheKeepalive
	) {
		return {
			strategy: "generated-current",
			intervalMs: config.cacheKeepaliveIntervalMinutes * 60_000,
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
	return (
		previousPlan?.strategy !== nextPlan?.strategy ||
		previousPlan?.intervalMs !== nextPlan?.intervalMs ||
		previousPlan?.maxOperations !== nextPlan?.maxOperations ||
		previousPlan?.maxDurationMs !== nextPlan?.maxDurationMs
	);
}
