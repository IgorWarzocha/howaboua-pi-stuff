import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, type Api, type Context, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { findLatestNativeCompactionEntry, findLatestNativeCompactionEntryIndex, resolveLatestNativeCompactionEntry, type LatestNativeCompactionResolution } from "./details-store.ts";
import { rewriteResponsesPayloadWithNativeReplay, serializeLiveTailToResponsesInput } from "../replay/payload-rewrite.ts";
import { DEFAULT_SUPPORTED_PROVIDERS, isResponsesCompatiblePayload, resolveNativeCompactionEnvironment, type ResponsesCompatibleRequestPayload } from "./compaction-runtime.ts";
import { convertResponsesTools } from "../../providers/openai-responses/shared.ts";
import {
	serializeActiveSessionToResponsesInput,
	type NativeCompactionRequestOptions,
	type ResponsesInputItem,
	type SerializeResponsesMessagesOptions,
} from "./serializer.ts";
import { createNativeCompactionDetails, createNativeCompactionShimResult, NATIVE_COMPACTION_SHIM_SUMMARY, type NativeCompactionEntry } from "../compaction/types.ts";
import { isResponsesContext } from "../prompt/codex-model.ts";
import { resolveCodexRuntimePlan } from "../activation/runtime-plan.ts";
import type { AdapterState } from "../activation/state.ts";
import { executeRemoteCompactionV2 } from "./remote-v2-client.ts";
import { buildRemoteCompactionV2Window } from "./remote-v2-history.ts";
import { CODE_MODE_EXEC_GRAMMAR_INPUTS } from "../../tools/code-mode/exec-contract.ts";
import { getActiveToolsInActiveOrder } from "../active-tools.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function stashLatestNativeWindowForPiCompactionFallback(
	ctx: ExtensionContext,
	branchEntries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>,
	runtime: { provider: string; api: string; baseUrl: string },
	state: AdapterState,
): boolean {
	state.pendingPiCompactionNativeWindow = undefined;
	const nativeEntry = findLatestNativeCompactionEntry(branchEntries, {
		provider: runtime.provider,
		api: runtime.api,
		baseUrl: runtime.baseUrl,
	});
	const compactedWindow = cloneCompactedWindow(nativeEntry?.details?.compactedWindow ?? []);
	if (!compactedWindow || compactedWindow.length === 0) return false;
	state.pendingPiCompactionNativeWindow = {
		window: compactedWindow,
		provider: runtime.provider,
		api: runtime.api,
		baseUrl: runtime.baseUrl,
		sessionId: ctx.sessionManager.getSessionId(),
		sourceCompactionEntryId: nativeEntry?.id,
	};
	return true;
}

function cloneCompactedWindow(window: readonly unknown[]): ResponsesInputItem[] | undefined {
	if (!window.every(isRecord)) return undefined;
	return window.map((item) => structuredClone(item));
}

function buildCompactionTools(pi: ExtensionAPI, codeMode: boolean): unknown[] | undefined {
	const tools = getActiveToolsInActiveOrder(pi, codeMode);
	if (tools.length === 0) return undefined;
	return convertResponsesTools(tools, { strict: null });
}

function buildCompactionReasoning(
	pi: Pick<ExtensionAPI, "getThinkingLevel">,
	ctx: ExtensionContext,
	state: AdapterState,
	compactionTargetModel: Model<Api>,
): NativeCompactionRequestOptions["reasoning"] {
	const level = pi.getThinkingLevel();
	if (!compactionTargetModel.reasoning || level === "off") return undefined;
	const clampedLevel = clampThinkingLevel(compactionTargetModel, level as ModelThinkingLevel);
	const rawEffort = compactionTargetModel.thinkingLevelMap?.[clampedLevel] ?? clampedLevel;
	const effort = typeof rawEffort === "string" && resolveCodexRuntimePlan(ctx, state.config).effectiveOpenAICodex
		? clampCodexReasoningEffort(compactionTargetModel.id, rawEffort)
		: rawEffort;
	return effort === null ? undefined : { effort, summary: "auto" };
}

function clampCodexReasoningEffort(modelId: string, effort: string): string {
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	const gpt5MinorMatch = /^gpt-5\.(\d+)/.exec(id);
	const gpt5Minor = gpt5MinorMatch ? Number.parseInt(gpt5MinorMatch[1]!, 10) : undefined;
	if (gpt5Minor !== undefined && gpt5Minor >= 2 && effort === "minimal") return "low";
	if (id === "gpt-5.1" && effort === "xhigh") return "high";
	if (id === "gpt-5.1-codex-mini") return effort === "high" || effort === "xhigh" ? "high" : "medium";
	return effort;
}

const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

function clampOpenAIPromptCacheKey(key: string): string {
	const chars = Array.from(key);
	if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) return key;
	return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}

function buildCompactionRequestOptions(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState, compactionTargetModel: Model<Api>, codeMode: boolean): NativeCompactionRequestOptions {
	const tools = buildCompactionTools(pi, codeMode);
	const reasoning = buildCompactionReasoning(pi, ctx, state, compactionTargetModel);
	return {
		parallel_tool_calls: true,
		prompt_cache_key: clampOpenAIPromptCacheKey(ctx.sessionManager.getSessionId()),
		...(resolveCodexRuntimePlan(ctx, state.config).effectiveOpenAICodex && state.config.openai.fast ? { service_tier: "priority" } : {}),
		text: { verbosity: state.config.openai.verbosity },
		...(tools ? { tools } : {}),
		...(reasoning ? { reasoning } : {}),
	};
}

function notifyNativeCompactionFallback(ctx: ExtensionContext, state: AdapterState, branchEntries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>, runtime: { provider: string; api: string; baseUrl: string }, message: string): void {
	const stashed = stashLatestNativeWindowForPiCompactionFallback(ctx, branchEntries, runtime, state);
	ctx.ui.notify(`${message}; Pi compaction will run.${stashed ? " Previous native compacted window will be included in Pi compaction fallback." : ""}`, "error");
}

function textFromResponsesContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => isRecord(item) && item["type"] === "input_text" && typeof item["text"]! === "string" ? item["text"]! : "")
		.join("\n");
}

function isPiCompactionSummarizationPayload(payload: ResponsesCompatibleRequestPayload): boolean {
	const instructions = typeof payload.instructions === "string" ? payload.instructions : "";
	if (/compact|summar/i.test(instructions)) return true;

	return payload.input.some((item) => {
		if (!isRecord(item)) return false;
		const role = item["role"]!;
		const text = textFromResponsesContent(item["content"]!);
		if ((role === "system" || role === "developer") && /compact|summar/i.test(text)) return true;
		if (role === "user" && /<conversation>|previous compaction summary|summary/i.test(text)) return true;
		return false;
	});
}

function getSupportedNativeCompactionProviders(state: AdapterState): string[] {
	return [...new Set([...DEFAULT_SUPPORTED_PROVIDERS, ...state.config.scope.additionalProviders])];
}

export function buildNativeCompactionInput(args: {
	model: Model<Api>;
	branchEntries: SessionEntry[];
	allEntries: SessionEntry[];
	leafId?: string | null | undefined;
	latestNativeCompaction: LatestNativeCompactionResolution;
	serializationOptions?: SerializeResponsesMessagesOptions | undefined;
}): { input: ResponsesInputItem[]; compactedKeptWindow: boolean } | undefined {
	if (args.latestNativeCompaction.ok) {
		const compactedWindow = cloneCompactedWindow(args.latestNativeCompaction.entry.details?.compactedWindow ?? []);
		if (!compactedWindow) return undefined;
		const liveTailEntries = args.branchEntries.slice(args.latestNativeCompaction.index + 1);
		return {
			input: [
				...compactedWindow,
				...serializeLiveTailToResponsesInput({ model: args.model, entries: liveTailEntries, serializationOptions: args.serializationOptions }),
			],
			compactedKeptWindow: false,
		};
	}

	return {
		input: serializeActiveSessionToResponsesInput({
			model: args.model,
			entries: args.allEntries,
			leafId: args.leafId,
			options: args.serializationOptions,
		}),
		compactedKeptWindow: true,
	};
}

export async function handleCodexSessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext, state: AdapterState, pi: ExtensionAPI) {
	if (!resolveCodexRuntimePlan(ctx, state.config).nativeCompaction) {
		return undefined;
	}

	try {
		return await handleCodexSessionBeforeCompactInner(event, ctx, state, pi);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`OpenAI native compaction failed unexpectedly: ${message}; Pi compaction was not run.`, "error");
		return { cancel: true };
	}
}

async function handleCodexSessionBeforeCompactInner(event: SessionBeforeCompactEvent, ctx: ExtensionContext, state: AdapterState, pi: ExtensionAPI) {
	const plan = resolveCodexRuntimePlan(ctx, state.config);
	if (!plan.effectiveOpenAICodex && !isResponsesContext(ctx)) {
		ctx.ui.notify("OpenAI native compaction is enabled, but the current model is not Responses-compatible; Pi compaction was not run.", "error");
		return { cancel: true };
	}
	if (event.signal.aborted) return { cancel: true };

	const resolution = await resolveNativeCompactionEnvironment(ctx, { enabled: true, supportedProviders: getSupportedNativeCompactionProviders(state) });
	if (!resolution.ok) {
		if (resolution.reason === "unsupported-provider" || resolution.reason === "unsupported-api") {
			return undefined;
		}
		ctx.ui.notify(`OpenAI native compaction is enabled but unavailable (${resolution.reason}); Pi compaction was not run.`, "error");
		return { cancel: true };
	}

	const runtime = resolution.runtime;
	const compactionTargetModel = runtime.currentModel;
	const codeMode = plan.kind === "code";
	const serializationOptions = codeMode ? { grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS } : undefined;
	const requestOptions = buildCompactionRequestOptions(pi, ctx, state, compactionTargetModel, codeMode);
	const branchEntries = ctx.sessionManager.getBranch();
	const latestNativeCompaction = resolveLatestNativeCompactionEntry(branchEntries, {
		provider: runtime.provider,
		api: runtime.api,
		baseUrl: runtime.baseUrl,
	});
	if (!latestNativeCompaction.ok && latestNativeCompaction.reason === "latest-native-compaction-mismatch") {
		ctx.ui.notify("OpenAI native compaction cannot reuse the latest checkpoint with this provider or endpoint; compaction was cancelled to preserve its encrypted history.", "error");
		return { cancel: true };
	}
	const builtInput = buildNativeCompactionInput({
		model: compactionTargetModel,
		branchEntries,
		allEntries: ctx.sessionManager.getEntries(),
		leafId: ctx.sessionManager.getLeafId(),
		latestNativeCompaction,
		serializationOptions,
	});
	if (!builtInput) {
		ctx.ui.notify("OpenAI native compaction could not clone the previous compacted window; Pi compaction was not run.", "error");
		return { cancel: true };
	}
	const { input, compactedKeptWindow } = builtInput;

	if (input.length === 0) {
		ctx.ui.notify("OpenAI native compaction had no serializable conversation items; Pi compaction was not run.", "error");
		return { cancel: true };
	}
	if (event.customInstructions?.trim()) {
		ctx.ui.notify("Responses compaction v2 uses the active session instructions and ignores custom /compact guidance.", "warning");
	}
	const tools = getActiveToolsInActiveOrder(pi, codeMode);
	const context: Context = {
		// Match the active provider lane so cached WebSocket compaction can send
		// only previous_response_id plus the trigger instead of the full history.
		systemPrompt: state.activeProviderSystemPrompt ?? ctx.getSystemPrompt(),
		messages: [],
		...(tools.length > 0 ? { tools } : {}),
	};
	const compactResult = await executeRemoteCompactionV2({
		runtime,
		modelRegistry: ctx.modelRegistry,
		context,
		promptInput: input,
		requestOptions,
		tokensBefore: event.preparation.tokensBefore,
		sessionId: ctx.sessionManager.getSessionId(),
		signal: event.signal,
	});
	if (!compactResult.ok) {
		if (compactResult.reason !== "aborted") {
			notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, `Responses compaction v2 failed (${compactResult.reason}): ${compactResult.errorMessage}`);
		}
		return compactResult.reason === "aborted" ? { cancel: true } : undefined;
	}
	const compactedWindow = buildRemoteCompactionV2Window(
		input,
		compactResult.compaction,
		(state.config.beta.v2UserMessageRetention ?? 64) * 1_000,
	);
	try {
		const details = createNativeCompactionDetails({
			provider: runtime.provider,
			api: runtime.api,
			model: runtime.model,
			baseUrl: runtime.baseUrl,
			compactedWindow,
			compactResponseId: compactResult.responseId,
			createdAt: compactResult.createdAt,
			usage: compactResult.usage,
			requestMeta: { tokensBefore: event.preparation.tokensBefore, previousSummaryPresent: Boolean(event.preparation.previousSummary), compactedKeptWindow },
		});
		return { compaction: createNativeCompactionShimResult({ summary: NATIVE_COMPACTION_SHIM_SUMMARY, firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore, details }) };
	} catch {
		notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, "Responses compaction v2 produced details Pi could not store");
		return undefined;
	}
}

export async function rewriteCodexCompactedProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const plan = resolveCodexRuntimePlan(ctx, state.config);
	if (!plan.nativeCompaction || (!plan.effectiveOpenAICodex && !isResponsesContext(ctx))) return undefined;
	const resolution = await resolveNativeCompactionEnvironment(ctx, { enabled: true, supportedProviders: getSupportedNativeCompactionProviders(state) }, payload);
	if (!resolution.ok) return undefined;
	const runtime = resolution.runtime;
	const branchEntries = ctx.sessionManager.getBranch();
	const latestNativeCompactionIndex = findLatestNativeCompactionEntryIndex(branchEntries, {
		provider: runtime.provider,
		api: runtime.api,
		baseUrl: runtime.baseUrl,
	});
	if (latestNativeCompactionIndex === undefined) return undefined;
	if (!runtime.payload) return undefined;
	const compactionEntry = branchEntries[latestNativeCompactionIndex]! as NativeCompactionEntry;
	const rewrite = rewriteResponsesPayloadWithNativeReplay({
		model: runtime.currentModel,
		payload: runtime.payload,
		branchEntries,
		compactionEntry,
		serializationOptions: plan.kind === "code" ? { grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS } : undefined,
	});
	if (rewrite.ok) return rewrite.rewrittenPayload;
	const detail = rewrite.parity?.mismatches.slice(0, 3).join("; ");
	const message = `OpenAI native compaction replay failed (${rewrite.reason})${detail ? `: ${detail}` : ""}; request was not sent with placeholder compaction context.`;
	ctx.ui.notify(message, "error");
	throw new Error(message);
}

export async function injectPendingNativeWindowIntoPiCompactionRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const pending = state.pendingPiCompactionNativeWindow;
	if (!pending || pending.window.length === 0) return undefined;
	if (!isResponsesCompatiblePayload(payload)) return undefined;
	if (pending.sessionId !== ctx.sessionManager.getSessionId()) {
		state.pendingPiCompactionNativeWindow = undefined;
		return undefined;
	}
	if (!isPiCompactionSummarizationPayload(payload)) return undefined;

	const resolution = await resolveNativeCompactionEnvironment(ctx, { enabled: true, supportedProviders: getSupportedNativeCompactionProviders(state) }, payload);
	if (!resolution.ok) return undefined;
	const runtime = resolution.runtime;
	if (pending.provider !== runtime.provider || pending.api !== runtime.api || pending.baseUrl !== runtime.baseUrl) {
		state.pendingPiCompactionNativeWindow = undefined;
		return undefined;
	}

	const input = [...payload.input];
	let insertAt = 0;
	while (insertAt < input.length) {
		const item = input[insertAt]!;
		if (!isRecord(item) || (item["role"] !== "system" && item["role"] !== "developer")) break;
		insertAt++;
	}

	state.pendingPiCompactionNativeWindow = undefined;
	return {
		...payload,
		input: [
			...input.slice(0, insertAt),
			...pending.window.map((item) => structuredClone(item)),
			...input.slice(insertAt),
		],
	};
}
