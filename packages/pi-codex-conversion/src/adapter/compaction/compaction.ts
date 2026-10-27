import { type CompactionResult, type ExtensionAPI, type ExtensionContext, type SessionBeforeCompactEvent, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { resolveLatestNativeCompactionEntry } from "./details-store.ts";
import { resolveNativeCompactionEnvironment, type NativeCompactionRuntime } from "./compaction-runtime.ts";
import { type ResponsesInputItem, type SerializeResponsesMessagesOptions } from "./serializer.ts";
import { createNativeCompactionDetails, createNativeCompactionShimResult, hasPortableNativeCompactionSummary, NATIVE_COMPACTION_SHIM_SUMMARY } from "./types.ts";
import { isResponsesContext } from "../prompt/codex-model.ts";
import { isCodeModeRuntime, resolveCodexRuntimePlanForState } from "../activation/runtime-plan.ts";
import type { AdapterState } from "../activation/state.ts";
import { executeRemoteCompactionV2 } from "./remote-v2-client.ts";
import { buildRemoteCompactionV2Window } from "./remote-v2-history.ts";
import { CODE_MODE_EXEC_GRAMMAR_INPUTS } from "../../tools/code-mode/exec-contract.ts";
import { extractAccountId, resolveCodexWebSocketUrl } from "../../providers/openai-codex/headers.ts";
import type { CodexCompactionDiagnostic } from "./diagnostics.ts";
import { runPortablePiCompaction } from "./portable-summary.ts";
import { withRemoteCompactionV2Feature } from "../../providers/openai-responses/compaction-v2-feature.ts";
import { rewriteRelationshipHeaders, rewriteRelationshipPayload } from "../../agent-relationship.ts";
import { buildCompactionRequestOptions, buildCompactionTranscript, buildNativeCompactionInput, resolveCanonicalCompactionReplay } from "./request.ts";
import { getSupportedNativeCompactionProviders, injectPendingNativeWindowIntoPiCompactionRequest, stashLatestNativeWindowForPiCompactionFallback } from "./provider-replay.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function notifyNativeCompactionFallback(ctx: ExtensionContext, state: AdapterState, branchEntries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>, runtime: { provider: string; api: string; baseUrl: string }, message: string): void {
	const stashed = stashLatestNativeWindowForPiCompactionFallback(ctx, branchEntries, runtime, state);
	ctx.ui.notify(`${message}; Pi compaction will run.${stashed ? " Previous native compacted window will be included in Pi compaction fallback." : ""}`, "error");
}

async function compactWithPiSummary(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	state: AdapterState,
	branchEntries: SessionEntry[],
	runtime?: NativeCompactionRuntime,
): Promise<CompactionResult> {
	const model = runtime?.currentModel ?? ctx.model;
	if (!model) throw new Error("No model selected for Pi compaction");
	const auth = runtime ?? await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if ("ok" in auth && !auth.ok) throw new Error(auth.error);
	const stashed = runtime ? stashLatestNativeWindowForPiCompactionFallback(ctx, branchEntries, runtime, state) : false;
	const headers = { ...auth.headers };
	const codexTransport = resolveCodexRuntimePlanForState(ctx, state).effectiveOpenAICodex;
	if (codexTransport) rewriteRelationshipHeaders(headers, ctx);
	try {
		const result = await runPortablePiCompaction({ ...event, branchEntries }, {
			model: auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model,
			thinkingLevel: ctx.thinkingLevel,
			apiKey: auth.apiKey,
			headers: stashed ? withRemoteCompactionV2Feature(headers) : headers,
			env: auth.env,
			onPayload: async (payload) => {
				const rewritten = (await injectPendingNativeWindowIntoPiCompactionRequest(payload, ctx, state)) ?? payload;
				return codexTransport ? rewriteRelationshipPayload(rewritten, ctx) : rewritten;
			},
		});
		if (stashed && state.pendingPiCompactionNativeWindow)
			throw new Error("the previous native checkpoint was not included in the summarization request");
		return result;
	} finally {
		state.pendingPiCompactionNativeWindow = undefined;
	}
}

export async function handleCodexSessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext, state: AdapterState, pi: ExtensionAPI) {
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	try {
		if (event.signal.aborted) return { cancel: true };
		// Compaction preparation is authoritative; never rebuild behind its edits.
		const branchEntries = event.branchEntries;
		const latest = resolveLatestNativeCompactionEntry(branchEntries);
		const opaque = latest.ok && !hasPortableNativeCompactionSummary(latest.entry);
		if (!plan.nativeCompaction && !(plan.nativeReplay && opaque)) return undefined;
		return await handleCodexSessionBeforeCompactInner(event, ctx, state, pi, branchEntries);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Compaction failed: ${message}; the existing checkpoint was kept.`, "error");
		return { cancel: true };
	}
}

async function handleCodexSessionBeforeCompactInner(event: SessionBeforeCompactEvent, ctx: ExtensionContext, state: AdapterState, pi: ExtensionAPI, branchEntries: SessionEntry[]) {
	const plan = resolveCodexRuntimePlanForState(ctx, state);
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
	if (runtime.codexTransport) {
		runtime.headers = { ...runtime.headers };
		rewriteRelationshipHeaders(runtime.headers, ctx);
	}
	const latestNativeCompaction = resolveLatestNativeCompactionEntry(branchEntries, {
		provider: runtime.provider,
		api: runtime.api,
		baseUrl: runtime.baseUrl,
	});
	if (
		!latestNativeCompaction.ok
		&& latestNativeCompaction.reason === "latest-native-compaction-mismatch"
		&& !hasPortableNativeCompactionSummary(latestNativeCompaction.latestCompaction)
	) {
		ctx.ui.notify("OpenAI native compaction cannot reuse the latest checkpoint with this provider or endpoint; compaction was cancelled to preserve its encrypted history.", "error");
		return { cancel: true };
	}
	if (!plan.nativeCompaction) {
		if (!latestNativeCompaction.ok || hasPortableNativeCompactionSummary(latestNativeCompaction.entry)) return undefined;
		return { compaction: await compactWithPiSummary(event, ctx, state, branchEntries, runtime) };
	}
	let portableCompaction: CompactionResult | undefined;
	if (state.config.compaction.method === "both") {
		try {
			portableCompaction = await compactWithPiSummary(event, ctx, state, branchEntries, runtime);
		} catch (error) {
			if (event.signal.aborted) return { cancel: true };
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Portable Pi summary failed (${message}); native compaction will continue without it.`, "warning");
		}
	}
	const codeMode = isCodeModeRuntime(plan);
	const serializationOptions: SerializeResponsesMessagesOptions = {
		...(plan.transport === "responses-lite" ? { grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS } : {}),
	};
	const requestOptions = buildCompactionRequestOptions(pi, ctx, state, compactionTargetModel, codeMode, branchEntries);
	const builtInput = buildNativeCompactionInput({
		model: compactionTargetModel,
		branchEntries,
		allEntries: branchEntries,
		leafId: branchEntries.at(-1)?.id,
		latestNativeCompaction,
		serializationOptions,
	});
	if (!builtInput) {
		ctx.ui.notify("OpenAI native compaction could not reconstruct the current conversation; Pi compaction was not run.", "error");
		return { cancel: true };
	}
	const canonicalReplay = runtime.codexTransport && runtime.apiKey
		? await resolveCanonicalCompactionReplay({
			codeMode,
			sessionId: ctx.sessionManager.getSessionId(),
			model: runtime.model,
			identity: {
				url: resolveCodexWebSocketUrl(runtime.baseUrl),
				accountId: extractAccountId(runtime.apiKey),
			},
			reconstructedInput: builtInput.input,
		})
		: { decision: "not_applicable" as const };
	const validatedCanonicalInput = canonicalReplay.input?.every(isRecord)
		? canonicalReplay.input as ResponsesInputItem[]
		: undefined;
	const input = validatedCanonicalInput ?? builtInput.input;
	const { compactedKeptWindow } = builtInput;
	const compactionDiagnostic: CodexCompactionDiagnostic = {
		model: runtime.model,
		inputSource: validatedCanonicalInput ? "canonical" : "reconstructed",
		canonicalReplay: canonicalReplay.decision,
		checkpointReused: latestNativeCompaction.ok,
		...(latestNativeCompaction.ok && latestNativeCompaction.entry.details?.model
			? { checkpointModel: latestNativeCompaction.entry.details.model }
			: {}),
	};

	if (input.length === 0) {
		ctx.ui.notify("OpenAI native compaction had no serializable conversation items; Pi compaction was not run.", "error");
		return { cancel: true };
	}
	if (event.customInstructions?.trim()) {
		ctx.ui.notify(
			portableCompaction
				? "Responses compaction v2 ignores custom /compact guidance; the portable Pi summary still uses it."
				: "Responses compaction v2 uses the active session instructions and ignores custom /compact guidance.",
			"warning",
		);
	}
	const context = buildCompactionTranscript(
		pi,
		ctx,
		state,
		runtime,
		plan.transport === "responses-lite" ? "responses-lite" : "responses",
		codeMode,
		branchEntries,
	);
	const compactResult = await executeRemoteCompactionV2({
		runtime,
		...(runtime.codexTransport ? { transport: pi.getSettings().transport ?? "auto" } : {}),
		modelRegistry: ctx.modelRegistry,
		remoteDeliveryContext: ctx,
		context,
		promptInput: input,
		promptInputSource: compactionDiagnostic.inputSource,
		compactionDiagnostic,
		requestOptions,
		rewritePayload: (payload: unknown) => runtime.codexTransport ? rewriteRelationshipPayload(payload, ctx) : payload,
		tokensBefore: event.preparation.tokensBefore,
		sessionId: ctx.sessionManager.getSessionId(),
		signal: event.signal,
	});
	if (!compactResult.ok) {
		if (compactResult.reason === "aborted") return { cancel: true };
		const message = `Responses compaction v2 failed (${compactResult.reason}): ${compactResult.errorMessage}`;
		if (portableCompaction) {
			state.pendingPiCompactionNativeWindow = undefined;
			ctx.ui.notify(`${message}; the saved portable Pi summary will be used.`, "error");
			return { compaction: portableCompaction };
		}
		notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, message);
		return undefined;
	}
	const compactedWindow = buildRemoteCompactionV2Window(
		input,
		compactResult.compaction,
		state.config.compaction.v2UserMessageRetention * 1_000,
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
		return {
			compaction: createNativeCompactionShimResult({
				summary: portableCompaction?.summary ?? NATIVE_COMPACTION_SHIM_SUMMARY,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details,
				usage: portableCompaction?.usage,
			}),
		};
	} catch {
		if (portableCompaction) {
			state.pendingPiCompactionNativeWindow = undefined;
			ctx.ui.notify("Responses compaction v2 produced details Pi could not store; the saved portable Pi summary will be used.", "error");
			return { compaction: portableCompaction };
		}
		notifyNativeCompactionFallback(ctx, state, branchEntries, runtime, "Responses compaction v2 produced details Pi could not store");
		return undefined;
	}
}
