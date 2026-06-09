import type { Api, Model } from "@earendil-works/pi-ai";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "../activation/state.ts";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_API = "openai-codex-responses";
const CODEX_AUTO_COMPACT_NUMERATOR = 9;
const CODEX_AUTO_COMPACT_DENOMINATOR = 10;
const PI_DEFAULT_COMPACTION_RESERVE_TOKENS = 16_384;
const CONTEXT_BUDGET_TAG_SYMBOL = Symbol.for("pi-codex-conversion.contextBudget");

interface ContextBudgetTag {
	rawContextWindow: number;
	adjustedContextWindows: number[];
}

const contextBudgetTags = new WeakMap<object, ContextBudgetTag>();

function isPositiveFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isContextBudgetTag(value: unknown): value is ContextBudgetTag {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as { rawContextWindow?: unknown; adjustedContextWindows?: unknown };
	return isPositiveFiniteNumber(candidate.rawContextWindow) && Array.isArray(candidate.adjustedContextWindows) && candidate.adjustedContextWindows.every(isPositiveFiniteNumber);
}

function getContextBudgetTag(model: Model<Api>): ContextBudgetTag | undefined {
	const tagged = (model as unknown as Record<PropertyKey, unknown>)[CONTEXT_BUDGET_TAG_SYMBOL];
	if (isContextBudgetTag(tagged)) return tagged;
	return contextBudgetTags.get(model);
}

function isKnownContextWindow(tag: ContextBudgetTag | undefined, contextWindow: number): tag is ContextBudgetTag {
	return tag !== undefined && (contextWindow === tag.rawContextWindow || tag.adjustedContextWindows.includes(contextWindow));
}

function rememberContextBudgetTag<TApi extends Api>(model: Model<TApi>, rawContextWindow: number, adjustedContextWindow?: number): void {
	const previousTag = getContextBudgetTag(model as Model<Api>);
	const adjustedContextWindows = new Set(previousTag?.rawContextWindow === rawContextWindow ? previousTag.adjustedContextWindows : []);
	if (adjustedContextWindow !== undefined) adjustedContextWindows.add(adjustedContextWindow);
	const tag: ContextBudgetTag = { rawContextWindow, adjustedContextWindows: [...adjustedContextWindows] };
	contextBudgetTags.set(model, tag);
	try {
		Object.defineProperty(model, CONTEXT_BUDGET_TAG_SYMBOL, {
			value: tag,
			writable: true,
			configurable: true,
			enumerable: false,
		});
	} catch {
		// Sealed model objects still remain idempotent within this module instance.
	}
}

export function getCodexAutoCompactBudget(contextWindow: number): number {
	return Math.floor((contextWindow * CODEX_AUTO_COMPACT_NUMERATOR) / CODEX_AUTO_COMPACT_DENOMINATOR);
}

export function getPiContextWindowForCodexAutoCompact(contextWindow: number, reserveTokens = PI_DEFAULT_COMPACTION_RESERVE_TOKENS): number {
	return Math.min(contextWindow, getCodexAutoCompactBudget(contextWindow) + reserveTokens);
}

function readSettings(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function getReserveTokens(settings: Record<string, unknown> | undefined): number | undefined {
	const compaction = settings?.["compaction"];
	if (!compaction || typeof compaction !== "object" || Array.isArray(compaction)) return undefined;
	const reserveTokens = (compaction as { reserveTokens?: unknown | undefined }).reserveTokens;
	return typeof reserveTokens === "number" && Number.isFinite(reserveTokens) && reserveTokens >= 0 ? reserveTokens : undefined;
}

export function readPiCompactionReserveTokens(cwd: string): number {
	return (
		getReserveTokens(readSettings(join(cwd, ".pi", "settings.json"))) ??
		getReserveTokens(readSettings(join(getAgentDir(), "settings.json"))) ??
		PI_DEFAULT_COMPACTION_RESERVE_TOKENS
	);
}

export function shouldUseCodexContextBudgetModel(model: Model<Api> | undefined): model is Model<Api> {
	return model?.provider === OPENAI_CODEX_PROVIDER && model.api === OPENAI_CODEX_API;
}

function getModelKey(model: Model<Api>): string {
	return `${model.provider}:${model.api}:${model.id}`;
}

function resolveRawContextWindow<TApi extends Api>(model: Model<TApi>, state: AdapterState | undefined): number {
	if (!state) {
		const tag = getContextBudgetTag(model as Model<Api>);
		return isKnownContextWindow(tag, model.contextWindow) ? tag.rawContextWindow : model.contextWindow;
	}
	const key = getModelKey(model);
	const cachedRaw = state.codexContextBudgetRawWindows?.[key];
	if (cachedRaw === undefined) {
		const tag = getContextBudgetTag(model as Model<Api>);
		const rawContextWindow = isKnownContextWindow(tag, model.contextWindow) ? tag.rawContextWindow : model.contextWindow;
		state.codexContextBudgetRawWindows ??= {};
		state.codexContextBudgetRawWindows[key] = rawContextWindow;
		rememberContextBudgetTag(model, rawContextWindow);
		return rawContextWindow;
	}

	const cachedAdjusted = getPiContextWindowForCodexAutoCompact(cachedRaw, state.codexContextBudgetReserveTokens);
	const previousAdjusted = state.codexContextBudgetAdjustedWindows?.[key];
	const tag = getContextBudgetTag(model as Model<Api>);
	const isKnownAdjustedFromAnotherState = tag?.rawContextWindow === cachedRaw && tag.adjustedContextWindows.includes(model.contextWindow);
	if (model.contextWindow !== cachedRaw && model.contextWindow !== cachedAdjusted && model.contextWindow !== previousAdjusted && !isKnownAdjustedFromAnotherState) {
		state.codexContextBudgetRawWindows ??= {};
		state.codexContextBudgetRawWindows[key] = model.contextWindow;
		delete state.codexContextBudgetAdjustedWindows?.[key];
		rememberContextBudgetTag(model, model.contextWindow);
		return model.contextWindow;
	}
	rememberContextBudgetTag(model, cachedRaw);
	return cachedRaw;
}

export function getCodexContextBudgetAdjustedModel<TApi extends Api>(model: Model<TApi>, state?: AdapterState): Model<TApi> {
	if (!shouldUseCodexContextBudgetModel(model)) return model;
	const rawContextWindow = resolveRawContextWindow(model, state);
	const contextWindow = getPiContextWindowForCodexAutoCompact(rawContextWindow, state?.codexContextBudgetReserveTokens);
	if (state) {
		state.codexContextBudgetAdjustedWindows ??= {};
		state.codexContextBudgetAdjustedWindows[getModelKey(model)] = contextWindow;
	}
	rememberContextBudgetTag(model, rawContextWindow, contextWindow);
	return contextWindow === model.contextWindow ? model : { ...model, contextWindow };
}

export function applyCodexContextBudgetToModel<TApi extends Api>(model: Model<TApi> | undefined, state: AdapterState): void {
	if (!model) return;
	state.codexContextBudgetReserveTokens ??= readPiCompactionReserveTokens(state.cwd);
	const adjustedModel = getCodexContextBudgetAdjustedModel(model, state);
	if (adjustedModel !== model) {
		model.contextWindow = adjustedModel.contextWindow;
	}
}
