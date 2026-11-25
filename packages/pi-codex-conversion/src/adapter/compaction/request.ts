import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	clampThinkingLevel,
	getCurrentSystemMessage,
	normalizeContext,
	type Api,
	type Model,
	type ModelThinkingLevel,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { LatestNativeCompactionResolution } from "./details-store.ts";
import { rewriteResponsesPayloadWithNativeReplay } from "../replay/payload-rewrite.ts";
import { convertResponsesTools } from "../../providers/openai-responses/shared.ts";
import {
	omitHiddenToolDeclarations,
	serializeActiveSessionToResponsesInput,
	type NativeCompactionRequestOptions,
	type ResponsesInputItem,
	type SerializeResponsesMessagesOptions,
} from "./serializer.ts";
import {
	resolveAdapterRuntimePlanForState,
	type ResponsesFormat,
} from "../activation/runtime-plan.ts";
import type { AdapterState } from "../activation/state.ts";
import { hiddenPiReplacementToolNames } from "../activation/tool-set.ts";
import { resolveFastModeServiceTier } from "../activation/fast-mode.ts";
import { getActiveToolsInActiveOrder } from "../active-tools.ts";
import { resolveCanonicalCompactionPromptInput } from "../../providers/openai-codex/session-continuity.ts";
import { prepareResponsesLiteConversationInput } from "../../providers/openai-codex/responses-lite.ts";
import { codexReasoningUpdates } from "../reasoning-updates.ts";
import { projectCodexDeveloperHistory } from "../developer-history.ts";
import { orderProjectContextLast } from "../../prompt/project-context-order.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function getCompactionTools(
	pi: ExtensionAPI,
	state: AdapterState,
	usesExecTools: boolean,
) {
	const hidden = hiddenPiReplacementToolNames(
		state.appliedRuntimeKind,
		pi.getActiveTools(),
	);
	return getActiveToolsInActiveOrder(pi, usesExecTools).filter(
		({ name }) => !hidden.includes(name),
	);
}

function buildCompactionReasoning(
	pi: Pick<ExtensionAPI, "getThinkingLevel">,
	ctx: ExtensionContext,
	state: AdapterState,
	compactionTargetModel: Model<Api>,
	branchEntries: SessionEntry[],
): NativeCompactionRequestOptions["reasoning"] {
	const level = pi.getThinkingLevel();
	if (!compactionTargetModel.reasoning || level === "off") return undefined;
	const initialEffort = codexReasoningUpdates(
		projectCodexDeveloperHistory(branchEntries),
		compactionTargetModel,
	)[0]?.initialEffort;
	if (initialEffort) return { effort: initialEffort, summary: "auto" };
	const clampedLevel = clampThinkingLevel(
		compactionTargetModel,
		level as ModelThinkingLevel,
	);
	const rawEffort =
		compactionTargetModel.thinkingLevelMap?.[clampedLevel] ?? clampedLevel;
	const effort =
		typeof rawEffort === "string" &&
		resolveAdapterRuntimePlanForState(ctx, state).codexOrConfiguredResponses
			? clampCodexReasoningEffort(compactionTargetModel.id, rawEffort)
			: rawEffort;
	return effort === null ? undefined : { effort, summary: "auto" };
}

function clampCodexReasoningEffort(modelId: string, effort: string): string {
	const id = modelId.includes("/")
		? (modelId.split("/").pop() ?? modelId)
		: modelId;
	const gpt5MinorMatch = /^gpt-5\.(\d+)/.exec(id);
	const gpt5Minor = gpt5MinorMatch
		? Number.parseInt(gpt5MinorMatch[1]!, 10)
		: undefined;
	if (gpt5Minor !== undefined && gpt5Minor >= 2 && effort === "minimal")
		return "low";
	if (id === "gpt-5.1" && effort === "xhigh") return "high";
	if (id === "gpt-5.1-codex-mini")
		return effort === "high" || effort === "xhigh" ? "high" : "medium";
	return effort;
}

const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

function clampOpenAIPromptCacheKey(key: string): string {
	const chars = Array.from(key);
	if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) return key;
	return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}

export function buildCompactionRequestOptions(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	compactionTargetModel: Model<Api>,
	usesExecTools: boolean,
	branchEntries: SessionEntry[],
): NativeCompactionRequestOptions {
	const tools = getCompactionTools(pi, state, usesExecTools);
	const reasoning = buildCompactionReasoning(
		pi,
		ctx,
		state,
		compactionTargetModel,
		branchEntries,
	);
	const codexOrConfiguredResponses = resolveAdapterRuntimePlanForState(
		{ model: compactionTargetModel },
		state,
	).codexOrConfiguredResponses;
	const serviceTier = codexOrConfiguredResponses
		? resolveFastModeServiceTier(
				state.config.openai.fast,
				compactionTargetModel.id,
			)
		: undefined;
	return {
		parallel_tool_calls: true,
		prompt_cache_key: clampOpenAIPromptCacheKey(
			ctx.sessionManager.getSessionId(),
		),
		...(serviceTier ? { service_tier: serviceTier } : {}),
		text: { verbosity: state.config.openai.verbosity },
		...(tools.length
			? { tools: convertResponsesTools(tools, { strict: false }) }
			: {}),
		...(reasoning ? { reasoning } : {}),
	};
}

export function buildCompactionTranscript(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	runtime: { provider: string; api: string; model: string; baseUrl: string },
	responsesFormat: ResponsesFormat,
	usesExecTools: boolean,
	branchEntries: SessionEntry[],
): TranscriptContext {
	const prepared = state.preparedPrompt;
	const hidden = hiddenPiReplacementToolNames(
		state.appliedRuntimeKind,
		pi.getActiveTools(),
	);
	if (
		prepared?.sessionId === ctx.sessionManager.getSessionId() &&
		prepared.provider === runtime.provider &&
		prepared.api === runtime.api &&
		prepared.model === runtime.model &&
		prepared.baseUrl === runtime.baseUrl &&
		prepared.executionMode === state.executionMode &&
		prepared.responsesFormat === responsesFormat
	) {
		return normalizeContext({
			messages: [
				orderProjectContextLast(
					omitHiddenToolDeclarations(
						structuredClone(prepared.systemMessage),
						hidden,
					),
				),
			],
		});
	}

	const current = getCurrentSystemMessage(
		projectCodexDeveloperHistory(branchEntries),
	);
	if (current)
		return normalizeContext({
			messages: [
				orderProjectContextLast(omitHiddenToolDeclarations(current, hidden)),
			],
		});
	const tools = getCompactionTools(pi, state, usesExecTools);
	return normalizeContext({
		systemPrompt: ctx.getSystemPrompt(),
		messages: [],
		...(tools.length > 0 ? { tools } : {}),
	});
}

export function buildNativeCompactionInput(args: {
	model: Model<Api>;
	branchEntries: SessionEntry[];
	allEntries: SessionEntry[];
	leafId?: string | null | undefined;
	latestNativeCompaction: LatestNativeCompactionResolution;
	serializationOptions?: SerializeResponsesMessagesOptions | undefined;
}): { input: ResponsesInputItem[]; compactedKeptWindow: boolean } | undefined {
	const input = serializeActiveSessionToResponsesInput({
		model: args.model,
		entries: args.allEntries,
		leafId: args.leafId,
		options: args.serializationOptions,
	});
	if (args.latestNativeCompaction.ok) {
		// Project the complete context before replacing Pi's summary/kept window,
		// just as generation does. A tail-only projection cannot restore guidance
		// that lives ahead of the compaction summary.
		const replay = rewriteResponsesPayloadWithNativeReplay({
			model: args.model,
			payload: { model: args.model.id, input },
			branchEntries: args.branchEntries,
			compactionEntry: args.latestNativeCompaction.entry,
			serializationOptions: args.serializationOptions,
		});
		if (!replay.ok || !replay.rewrittenPayload.input.every(isRecord))
			return undefined;
		return {
			input: replay.rewrittenPayload.input,
			compactedKeptWindow: false,
		};
	}

	return { input, compactedKeptWindow: true };
}

export async function resolveCanonicalCompactionReplay(args: {
	responsesFormat: ResponsesFormat;
	sessionId: string;
	model: string;
	identity?: { url: string; accountId: string } | undefined;
	reconstructedInput: readonly ResponsesInputItem[];
}) {
	const reconstructedInput =
		args.responsesFormat === "responses-lite"
			? await prepareResponsesLiteConversationInput(
					args.reconstructedInput,
					args.sessionId,
				)
			: args.reconstructedInput;
	return resolveCanonicalCompactionPromptInput(
		args.sessionId,
		args.model,
		args.identity,
		reconstructedInput,
	);
}
