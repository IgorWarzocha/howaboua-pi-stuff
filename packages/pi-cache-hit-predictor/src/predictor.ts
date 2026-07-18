import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const UNKNOWN_THINKING_LEVEL = "unknown";

export interface CacheLane {
	provider: string;
	api: string;
	model: string;
	thinkingLevel: string;
}

export interface CacheLaneSnapshot extends CacheLane {
	promptTokens: number;
}

export interface CacheHistory {
	lanes: Map<string, CacheLaneSnapshot>;
}

export interface CachePrediction {
	lane: CacheLane;
	estimatedCacheTokens: number;
	currentPromptTokens: number | null;
	percent: number | null;
	hasLaneHistory: boolean;
}

export function cacheLaneKey(lane: CacheLane): string {
	return JSON.stringify([
		lane.provider,
		lane.api,
		lane.model,
		lane.thinkingLevel,
	]);
}

export function promptTokens(usage: {
	input: number;
	cacheRead: number;
	cacheWrite: number;
}): number {
	return usage.input + usage.cacheRead + usage.cacheWrite;
}

export function scanCacheHistory(
	entries: readonly SessionEntry[],
	initialThinkingLevel = UNKNOWN_THINKING_LEVEL,
): CacheHistory {
	const history: CacheHistory = { lanes: new Map() };
	let thinkingLevel = initialThinkingLevel;

	for (const entry of entries) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
			continue;
		}

		if (entry.type === "compaction" || entry.type === "branch_summary") {
			history.lanes.clear();
			continue;
		}

		if (entry.type !== "message" || entry.message.role !== "assistant") {
			continue;
		}

		const message = entry.message;
		if (message.stopReason === "aborted" || message.stopReason === "error") {
			continue;
		}

		const tokens = promptTokens(message.usage);
		if (tokens <= 0) continue;

		const lane: CacheLane = {
			provider: message.provider,
			api: message.api,
			model: message.model,
			thinkingLevel,
		};

		history.lanes.set(cacheLaneKey(lane), {
			...lane,
			promptTokens: tokens,
		});
	}

	return history;
}

export function recordAssistantUsage(
	history: CacheHistory,
	message: Extract<SessionEntry, { type: "message" }>["message"],
	lane: CacheLane,
): void {
	if (
		message.role !== "assistant" ||
		message.stopReason === "aborted" ||
		message.stopReason === "error"
	) {
		return;
	}

	const tokens = promptTokens(message.usage);
	if (tokens <= 0) return;

	history.lanes.set(cacheLaneKey(lane), {
		...lane,
		promptTokens: tokens,
	});
}

export function predictCacheHit(
	history: CacheHistory,
	lane: CacheLane,
	currentPromptTokens: number | null,
): CachePrediction {
	const snapshot = history.lanes.get(cacheLaneKey(lane));
	const currentTokens =
		currentPromptTokens !== null && currentPromptTokens > 0
			? currentPromptTokens
			: null;
	const estimatedCacheTokens = snapshot
		? Math.min(snapshot.promptTokens, currentTokens ?? snapshot.promptTokens)
		: 0;

	return {
		lane,
		estimatedCacheTokens,
		currentPromptTokens: currentTokens,
		percent:
			currentTokens === null
				? null
				: Math.min(100, (estimatedCacheTokens / currentTokens) * 100),
		hasLaneHistory: snapshot !== undefined,
	};
}
