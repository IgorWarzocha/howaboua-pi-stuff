import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CONTEXT_WINDOW_FALLBACK_BUFFER,
	CONTEXT_WINDOW_FALLBACK_MESSAGE,
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
	private readonly exhaustedWindows = new Set<string>();

	reset(): void {
		this.remindedWindows.clear();
		this.exhaustedWindows.clear();
	}

	restore(kind: ContextManagementMessageKind, windowId: string): void {
		if (kind === "reminder") this.remindedWindows.add(windowId);
		if (kind === "fallback") this.exhaustedWindows.add(windowId);
	}

	record(
		ctx: ExtensionContext,
		identity: ContextWindowIdentity,
		contextTokens?: number,
	): { content: string; kind: "fallback" | "reminder" } | undefined {
		const remaining = this.remaining(ctx, identity, contextTokens);
		if (remaining.remainingTokens === undefined) return;
		const windowId = identity.currentWindowId;
		if (remaining.remainingTokens <= 0 && !this.exhaustedWindows.has(windowId)) {
			this.exhaustedWindows.add(windowId);
			return { content: CONTEXT_WINDOW_FALLBACK_MESSAGE, kind: "fallback" };
		}
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
		if (!usage && contextTokens === undefined)
			return {
				remainingTokens: undefined,
				windowId: identity?.currentWindowId,
				contextWindow: Math.max(
					0,
					(ctx.model?.contextWindow ?? 0) - CONTEXT_WINDOW_FALLBACK_BUFFER,
				),
			};
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const limit = Math.max(0, contextWindow - CONTEXT_WINDOW_FALLBACK_BUFFER);
		return {
			remainingTokens:
				contextTokens !== undefined
					? Math.max(0, limit - contextTokens)
					: usage?.tokens === null || usage?.tokens === undefined
						? undefined
						: Math.max(0, limit - usage.tokens),
			windowId: identity?.currentWindowId,
			contextWindow: limit,
		};
	}
}
