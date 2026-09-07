import { getAgentDir, SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CONTEXT_WINDOW_MIN_RESERVE,
	CONTEXT_WINDOW_REMINDER_THRESHOLD,
	renderContextWindowReminder,
	type ContextManagementMessageKind,
	type ContextWindowIdentity,
} from "./messages.ts";

export interface ContextRemaining {
	remainingTokens: number | undefined;
	windowId: string | undefined;
	contextWindow: number;
}

export class ContextWindowBudget {
	private readonly remindedWindows = new Set<string>();

	reset(): void {
		this.remindedWindows.clear();
	}

	restore(kind: ContextManagementMessageKind, windowId: string): void {
		if (kind === "reminder" || kind === "fallback") this.remindedWindows.add(windowId);
	}

	record(
		ctx: ExtensionContext,
		identity: ContextWindowIdentity,
		contextTokens?: number,
	): { content: string; kind: "reminder" } | undefined {
		const remaining = this.remaining(ctx, identity, contextTokens);
		if (remaining.remainingTokens === undefined) return;
		const windowId = identity.currentWindowId;
		if (
			remaining.remainingTokens <= CONTEXT_WINDOW_REMINDER_THRESHOLD &&
			!this.remindedWindows.has(windowId)
		) {
			this.remindedWindows.add(windowId);
			return { content: renderContextWindowReminder(remaining.remainingTokens), kind: "reminder" };
		}
	}

	remaining(
		ctx: ExtensionContext,
		identity: ContextWindowIdentity | undefined,
		contextTokens?: number,
	): ContextRemaining {
		const usage = ctx.getContextUsage();
		const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
			projectTrusted: ctx.isProjectTrusted(),
		});
		const reserveTokens = Math.max(CONTEXT_WINDOW_MIN_RESERVE, settings.getCompactionSettings().reserveTokens);
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const limit = Math.max(0, contextWindow - reserveTokens);
		const tokens = contextTokens ?? usage?.tokens;
		return {
			remainingTokens: tokens === null || tokens === undefined ? undefined : Math.max(0, limit - tokens),
			windowId: identity?.currentWindowId,
			contextWindow: limit,
		};
	}
}
