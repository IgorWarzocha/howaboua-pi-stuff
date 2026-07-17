import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, type Api, type Context, type Model, type ModelThinkingLevel, type Tool } from "@earendil-works/pi-ai";
import { executeNativeCompaction } from "./compact-client.ts";
import { extractCompactionSummaryText, hasCompactionOutputItem, sanitizeCompactedWindow, summarizeCompactionOutputForDiagnostics } from "./compaction-output.ts";
import { findLatestNativeCompactionEntry, findLatestNativeCompactionEntryIndex, resolveLatestNativeCompactionEntry, type LatestNativeCompactionResolution } from "./details-store.ts";
import { shrinkNativeCompactionRequestForEndpoint } from "./request-shrink.ts";
import { rewriteResponsesPayloadWithNativeReplay, serializeLiveTailToResponsesInput } from "../replay/payload-rewrite.ts";
import { DEFAULT_SUPPORTED_PROVIDERS, isResponsesCompatiblePayload, resolveNativeCompactionEnvironment, type ResponsesCompatibleRequestPayload } from "./compaction-runtime.ts";
import { formatCodexUsageLimitError } from "../../providers/openai-codex/errors.ts";
import { convertResponsesTools } from "../../providers/openai-responses/shared.ts";
import {
	serializeActiveSessionToCompactRequest,
	type NativeCompactionRequestBody,
	type NativeCompactionRequestOptions,
	type ResponsesInputItem,
} from "./serializer.ts";
import { createNativeCompactionDetails, createNativeCompactionShimResult, NATIVE_COMPACTION_SHIM_SUMMARY, NATIVE_COMPACTION_V2_STRATEGY, type NativeCompactionEntry } from "../compaction/types.ts";
import { applyResponsesLiteRequest, prepareResponsesLiteRequestImages, supportsResponsesLiteModel } from "../../providers/openai-codex/responses-lite.ts";
import { applyCodeModeFreeformContract } from "../code-mode-contract.ts";
import { isResponsesContext } from "../prompt/codex-model.ts";
import { isEffectiveOpenAICodexContext, shouldUseNativeResponsesCompaction } from "../activation/activation.ts";
import type { AdapterState } from "../activation/state.ts";
import { executeRemoteCompactionV2 } from "./remote-v2-client.ts";
import { buildRemoteCompactionV2Window } from "./remote-v2-history.ts";

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

function buildCompactionInstructions(systemPrompt: string, customInstructions?: string): string {
	const guidance = customInstructions?.trim();
	return guidance ? `${systemPrompt}\n\nAdditional user guidance for this manual /compact request:\n${guidance}` : systemPrompt;
}

function getActiveCompactionTools(pi: ExtensionAPI): Tool[] {
	const activeToolNames = new Set(pi.getActiveTools());
	return pi
		.getAllTools()
		.filter((tool) => activeToolNames.has(tool.name))
		.map((tool): Tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

function buildCompactionTools(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): unknown[] | undefined {
	void ctx;
	void state;
	const tools = getActiveCompactionTools(pi);
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
	const effort = typeof rawEffort === "string" && isEffectiveOpenAICodexContext(ctx, state.config)
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

function buildCompactionRequestOptions(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState, compactionTargetModel: Model<Api>): NativeCompactionRequestOptions {
	const tools = buildCompactionTools(pi, ctx, state);
	const reasoning = buildCompactionReasoning(pi, ctx, state, compactionTargetModel);
	return {
		parallel_tool_calls: true,
		prompt_cache_key: clampOpenAIPromptCacheKey(ctx.sessionManager.getSessionId()),
		...(isEffectiveOpenAICodexContext(ctx, state.config) && state.config.openai.fast ? { service_tier: "priority" } : {}),
		text: { verbosity: state.config.openai.verbosity },
		...(tools ? { tools } : {}),
		...(reasoning ? { reasoning } : {}),
	};
}

function formatCompactFailureMessage(compactResult: Awaited<ReturnType<typeof executeNativeCompaction>>): string {
	if (compactResult.ok) return "OpenAI native compaction succeeded";
	const status = compactResult.status ? ` HTTP ${compactResult.status}` : "";
	const friendly = formatCodexUsageLimitError(compactResult.responseJson ?? compactResult.responseText ?? compactResult.errorMessage);
	if (friendly) return `OpenAI native compaction failed (${compactResult.reason}${status}): ${friendly}`;
	const response = compactResult.responseText?.trim();
	const detail = response ? `: ${response.slice(0, 500)}` : compactResult.errorMessage ? `: ${compactResult.errorMessage}` : "";
	return `OpenAI native compaction failed (${compactResult.reason}${status})${detail}`;
}

function formatCompactRequestDiagnostics(request: NativeCompactionRequestBody): string {
	const reasoning = isRecord(request.reasoning) && typeof request.reasoning["effort"]! === "string" ? request.reasoning["effort"]! : "none";
	const serviceTier = typeof request.service_tier === "string" ? request.service_tier : "none";
	const tools = Array.isArray(request.tools) ? request.tools.length : 0;
	return `model=${request.model}, input=${request.input.length}, tools=${tools}, reasoning=${reasoning}, service_tier=${serviceTier}`;
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

export function buildNativeCompactionRequest(args: {
	model: Model<Api>;
	branchEntries: SessionEntry[];
	allEntries: SessionEntry[];
	leafId?: string | null | undefined;
	latestNativeCompaction: LatestNativeCompactionResolution;
	instructions: string;
	requestOptions: NativeCompactionRequestOptions;
}): { request: NativeCompactionRequestBody; compactedKeptWindow: boolean } | undefined {
	if (args.latestNativeCompaction.ok) {
		const compactedWindow = cloneCompactedWindow(args.latestNativeCompaction.entry.details?.compactedWindow ?? []);
		if (!compactedWindow) return undefined;
		const liveTailEntries = args.branchEntries.slice(args.latestNativeCompaction.index + 1);
		return {
			request: {
				model: args.model.id,
				input: [
					...compactedWindow,
					...serializeLiveTailToResponsesInput({ model: args.model, entries: liveTailEntries }),
				],
				instructions: args.instructions,
				...args.requestOptions,
			},
			compactedKeptWindow: false,
		};
	}

	return {
		request: serializeActiveSessionToCompactRequest({
			model: args.model,
			entries: args.allEntries,
			leafId: args.leafId,
			instructions: args.instructions,
			requestOptions: args.requestOptions,
		}),
		compactedKeptWindow: true,
	};
}

export async function handleCodexSessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext, state: AdapterState, pi: ExtensionAPI) {
	if (!shouldUseNativeResponsesCompaction(ctx, state.config)) {
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
	if (!isEffectiveOpenAICodexContext(ctx, state.config) && !isResponsesContext(ctx)) {
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
	const compactionVersion = state.config.compaction.version ?? "v1";
	const useV2 = compactionVersion === "v2";
	const compactionTargetModel = runtime.currentModel;
	const requestOptions = buildCompactionRequestOptions(pi, ctx, state, compactionTargetModel);
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
	const builtRequest = buildNativeCompactionRequest({
		model: compactionTargetModel,
		branchEntries,
		allEntries: ctx.sessionManager.getEntries(),
		leafId: ctx.sessionManager.getLeafId(),
		latestNativeCompaction,
		instructions: buildCompactionInstructions(ctx.getSystemPrompt(), event.customInstructions),
		requestOptions,
	});
	if (!builtRequest) {
		ctx.ui.notify("OpenAI native compaction could not clone the previous compacted window; Pi compaction was not run.", "error");
		return { cancel: true };
	}
	let { request } = builtRequest;
	const { compactedKeptWindow } = builtRequest;

	if (request.input.length === 0) {
		ctx.ui.notify("OpenAI native compaction had no serializable conversation items; Pi compaction was not run.", "error");
		return { cancel: true };
	}
	if (useV2) {
		if (event.customInstructions?.trim()) {
			ctx.ui.notify("Responses compaction v2 uses the active session instructions and ignores custom /compact guidance.", "warning");
		}
		const tools = getActiveCompactionTools(pi);
		const context: Context = {
			systemPrompt: ctx.getSystemPrompt(),
			messages: [],
			...(tools.length > 0 ? { tools } : {}),
		};
		const compactResult = await executeRemoteCompactionV2({
			runtime,
			modelRegistry: ctx.modelRegistry,
			context,
			promptInput: request.input,
			requestOptions,
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
			request.input,
			compactResult.compaction,
			(state.config.beta.v2UserMessageRetention ?? 64) * 1_000,
		);
		try {
			const details = createNativeCompactionDetails({
				strategy: NATIVE_COMPACTION_V2_STRATEGY,
				provider: runtime.provider,
				api: runtime.api,
				model: runtime.model,
				baseUrl: runtime.baseUrl,
				compactedWindow,
				compactResponseId: compactResult.responseId,
				createdAt: compactResult.createdAt,
				requestMeta: { tokensBefore: event.preparation.tokensBefore, previousSummaryPresent: Boolean(event.preparation.previousSummary), compactedKeptWindow },
			});
			return { compaction: createNativeCompactionShimResult({ summary: NATIVE_COMPACTION_SHIM_SUMMARY, firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore, details }) };
		} catch {
			notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, "Responses compaction v2 produced details Pi could not store");
			return undefined;
		}
	}
	const responsesLite = state.config.beta.codeMode && runtime.provider === "openai-codex" && supportsResponsesLiteModel(runtime.model);
	if (responsesLite) request = await prepareResponsesLiteRequestImages(applyResponsesLiteRequest(applyCodeModeFreeformContract(request)));

	request = (await shrinkNativeCompactionRequestForEndpoint(request, { contextWindow: compactionTargetModel.contextWindow })).request;

	const compactResult = await executeNativeCompaction({
		runtime,
		request,
		signal: event.signal,
		responsesLite,
		turnState: state.codexTurnState,
		sessionId: ctx.sessionManager.getSessionId(),
	});
	if (!compactResult.ok) {
		if (compactResult.reason !== "aborted") {
			notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, formatCompactFailureMessage(compactResult));
		}
		return compactResult.reason === "aborted" ? { cancel: true } : undefined;
	}
	const compactedWindow = sanitizeCompactedWindow(compactResult.compactedWindow);
	if (compactedWindow.length === 0) {
		notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, `OpenAI native compaction returned no installable compacted context. Request: ${formatCompactRequestDiagnostics(request)}. Output: ${summarizeCompactionOutputForDiagnostics(compactResult.compactedWindow, compactedWindow)}`);
		return undefined;
	}
	if (!hasCompactionOutputItem(compactedWindow)) {
		notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, `OpenAI native compaction did not return a compaction item. Response=${compactResult.compactResponseId ?? "<none>"}. Request: ${formatCompactRequestDiagnostics(request)}. Output: ${summarizeCompactionOutputForDiagnostics(compactResult.compactedWindow, compactedWindow)}`);
		return undefined;
	}
	const encryptedSummary = extractCompactionSummaryText(compactedWindow);
	if (!encryptedSummary) {
		notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, `OpenAI native compaction returned compacted context without a displayable summary. Response=${compactResult.compactResponseId ?? "<none>"}. Request: ${formatCompactRequestDiagnostics(request)}. Output: ${summarizeCompactionOutputForDiagnostics(compactResult.compactedWindow, compactedWindow)}`);
		return undefined;
	}
	try {
		const details = createNativeCompactionDetails({
			provider: runtime.provider,
			api: runtime.api,
			model: runtime.model,
			baseUrl: runtime.baseUrl,
			compactedWindow,
			compactResponseId: compactResult.compactResponseId,
			createdAt: compactResult.createdAt,
			requestMeta: { tokensBefore: event.preparation.tokensBefore, previousSummaryPresent: Boolean(event.preparation.previousSummary), compactedKeptWindow },
		});
		return { compaction: createNativeCompactionShimResult({ summary: NATIVE_COMPACTION_SHIM_SUMMARY, firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore, details }) };
	} catch {
		notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, "OpenAI native compaction produced details Pi could not store");
		return undefined;
	}
}

export async function rewriteCodexCompactedProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	if (!shouldUseNativeResponsesCompaction(ctx, state.config) || (!isEffectiveOpenAICodexContext(ctx, state.config) && !isResponsesContext(ctx))) return undefined;
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
	const rewrite = rewriteResponsesPayloadWithNativeReplay({ model: runtime.currentModel, payload: runtime.payload, branchEntries, compactionEntry });
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
