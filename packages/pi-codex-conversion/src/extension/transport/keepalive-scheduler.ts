import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "../../adapter/activation/state.ts";
import { resolveCodexCacheKeepalivePlan, type CodexCacheKeepalivePlan } from "../../adapter/activation/cache-keepalive.ts";
import { projectCodexDeveloperEntry } from "../../adapter/developer-history.ts";
import type { createLazyCodexDiagnostics } from "../../diagnostics/lazy.ts";
import type { CodexPrewarmResult } from "../runtime.ts";

export function createCacheKeepaliveScheduler(
	state: AdapterState,
	startPrewarm: (ctx: ExtensionContext) => Promise<CodexPrewarmResult> | undefined,
	cancelPendingPrewarm: () => void,
	diagnostics: ReturnType<typeof createLazyCodexDiagnostics>,
) {
	let cacheKeepaliveTimer: ReturnType<typeof setTimeout> | undefined;
	let cacheKeepaliveEpoch = 0;
	const cancelCacheKeepalive = () => {
		cacheKeepaliveEpoch++;
		if (cacheKeepaliveTimer) clearTimeout(cacheKeepaliveTimer);
		cacheKeepaliveTimer = undefined;
		cancelPendingPrewarm();
	};
	// Settlement can append storage-only metadata after this extension's hook.
	// Retain invalidation for conversation/window entries and projected instructions.
	const keepaliveBoundary = (ctx: ExtensionContext) => ctx.sessionManager.getBranch()
		.findLast(entry => projectCodexDeveloperEntry(entry).type !== "custom")?.id;

	const scheduleCacheKeepalive = (
		ctx: ExtensionContext,
		epoch: number,
		plan: CodexCacheKeepalivePlan,
		completedOperations: number,
		deadline: number | undefined,
	) => {
		if (plan.maxOperations !== undefined && completedOperations >= plan.maxOperations) return;
		if (deadline !== undefined && Date.now() + plan.intervalMs > deadline) return;
		if (cacheKeepaliveTimer) clearTimeout(cacheKeepaliveTimer);
		diagnostics.sink()?.({
			type: "keepalive",
			phase: "armed",
			strategy: plan.strategy,
			intervalMs: plan.intervalMs,
		});
		const boundary = keepaliveBoundary(ctx);
		cacheKeepaliveTimer = setTimeout(() => {
			cacheKeepaliveTimer = undefined;
			if (epoch !== cacheKeepaliveEpoch || !ctx.isIdle() || keepaliveBoundary(ctx) !== boundary || (deadline !== undefined && Date.now() > deadline)) return;
			const nextCompletedOperations = completedOperations + 1;
			const requestSource = "captured";
			diagnostics.sink()?.({ type: "keepalive", phase: "started", strategy: plan.strategy, requestSource });
			const keepalive = startPrewarm(ctx);
			if (!keepalive) {
				diagnostics.sink()?.({ type: "keepalive", phase: "skipped", strategy: plan.strategy, requestSource });
				return;
			}
			void keepalive.then((result) => {
				if (epoch !== cacheKeepaliveEpoch || result.status === "aborted" || result.status === "skipped") return;
				if (result.status === "failed") {
					ctx.ui.notify(`Codex cache keepalive failed: ${result.error.message}`, "warning");
					scheduleCacheKeepalive(ctx, epoch, plan, nextCompletedOperations, deadline);
					return;
				}
				const action = "generated-refresh";
				diagnostics.sink()?.({ type: "keepalive", phase: "applied", strategy: plan.strategy, requestSource, action });
				scheduleCacheKeepalive(ctx, epoch, plan, nextCompletedOperations, deadline);
			});
		}, plan.intervalMs);
		cacheKeepaliveTimer.unref?.();
	};

	const armCacheKeepalive = (ctx: ExtensionContext) => {
		cancelCacheKeepalive();
		const plan = resolveCodexCacheKeepalivePlan(ctx.model?.id, state.config.openai);
		if (plan) scheduleCacheKeepalive(ctx, cacheKeepaliveEpoch, plan, 0,
			plan.maxDurationMs === undefined ? undefined : Date.now() + plan.maxDurationMs);
	};

	return { arm: armCacheKeepalive, cancel: cancelCacheKeepalive };
}
