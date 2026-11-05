import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type CacheLane,
	type CachePrediction,
	predictCacheHit,
	recordAssistantUsage,
	scanCacheHistory,
} from "./src/predictor.js";

interface ModelIdentity {
	provider: string;
	api: string;
	id: string;
}

function formatTokens(tokens: number): string {
	if (tokens < 1_000) return Math.round(tokens).toString();
	if (tokens < 1_000_000) {
		return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
	}
	return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}m`;
}

function predictionText(prediction: CachePrediction): string {
	const lane = `${prediction.lane.model} · ${prediction.lane.thinkingLevel}`;
	if (!prediction.hasLaneHistory) {
		const prompt = prediction.currentPromptTokens
			? ` of ~${formatTokens(prediction.currentPromptTokens)}`
			: "";
		return `Cache hit prediction · ${lane}: cold lane (0%${prompt})`;
	}

	if (prediction.currentPromptTokens === null || prediction.percent === null) {
		return `Cache hit prediction · ${lane}: ~${formatTokens(prediction.estimatedCacheTokens)} cached`;
	}
	return `Cache hit prediction · ${lane}: ~${formatTokens(prediction.estimatedCacheTokens)} / ~${formatTokens(prediction.currentPromptTokens)} (${Math.round(prediction.percent)}%) cached`;
}

function laneFor(model: ModelIdentity, thinkingLevel: string): CacheLane {
	return {
		provider: model.provider,
		api: model.api,
		model: model.id,
		thinkingLevel,
	};
}

export default function (pi: ExtensionAPI) {
	let history = scanCacheHistory([]);
	let pendingPredictionTimer: ReturnType<typeof setTimeout> | undefined;

	const rebuild = (ctx: ExtensionContext) => {
		history = scanCacheHistory(
			ctx.sessionManager.getBranch(),
			pi.getThinkingLevel(),
		);
	};

	const appendPrediction = (
		ctx: ExtensionContext,
		model: ModelIdentity,
		thinkingLevel: string,
	) => {
		if (ctx.mode !== "tui") return;
		const contextTokens = ctx.getContextUsage()?.tokens ?? null;
		const prediction = predictCacheHit(
			history,
			laneFor(model, thinkingLevel),
			contextTokens,
		);
		ctx.ui.notify(predictionText(prediction), "info");
	};

	const schedulePrediction = (
		ctx: ExtensionContext,
		model: ModelIdentity,
		thinkingLevel: string,
	) => {
		if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
		pendingPredictionTimer = setTimeout(() => {
			pendingPredictionTimer = undefined;
			appendPrediction(ctx, model, thinkingLevel);
		}, 0);
	};

	pi.on("session_start", async (_event, ctx) => rebuild(ctx));
	pi.on("session_tree", async (_event, ctx) => rebuild(ctx));
	pi.on("session_compact", async (_event, ctx) => rebuild(ctx));

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const selected = ctx.model;
		recordAssistantUsage(
			history,
			event.message,
			laneFor(
				selected?.provider === event.message.provider &&
					selected.id === event.message.model &&
					selected.api === event.message.api
					? selected
					: {
							provider: event.message.provider,
							api: event.message.api,
							id: event.message.model,
						},
				pi.getThinkingLevel(),
			),
		);
	});

	pi.on("thinking_level_select", async (event, ctx) => {
		if (event.level === event.previousLevel || !ctx.model) return;
		schedulePrediction(ctx, ctx.model, event.level);
	});

	pi.on("model_select", async (event, ctx) => {
		if (event.source === "restore" || !event.previousModel) {
			if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
			pendingPredictionTimer = undefined;
			return;
		}
		schedulePrediction(ctx, event.model, pi.getThinkingLevel());
	});

	pi.on("session_shutdown", async () => {
		if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
		pendingPredictionTimer = undefined;
	});
}
