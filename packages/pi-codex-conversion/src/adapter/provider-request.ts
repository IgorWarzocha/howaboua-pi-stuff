import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import { isResponsesContext } from "./prompt/codex-model.ts";
import { applyCodexRequestOptions } from "./request-options.ts";
import type { AdapterState } from "./activation/state.ts";
import { isAdapterRuntime, resolveCodexRuntimePlanForState } from "./activation/runtime-plan.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction/compaction.ts";
import { applyResponsesLiteRequest, RESPONSES_LITE_HEADER, type ResponsesLiteCompatibleBody } from "../providers/openai-codex/responses-lite.ts";
import { usesRemoteHistoryNotes } from "../context-management/history-notes.ts";
import { rewriteContextNamespaceTools } from "../context-management/namespace-tools.ts";

function prepareCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState) {
	if (state.config.voiceFeaturesOnly) return undefined;
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	if (!isAdapterRuntime(plan) || (!plan.effectiveOpenAICodex && !isResponsesContext(ctx))) {
		return undefined;
	}
	return {
		plan,
		configuredPayload: applyCodexRequestOptions(payload, state.config, {
			serviceTier: plan.effectiveOpenAICodex,
			verbosity: true,
		}),
	};
}

export function supportsCodexDeveloperMessages(
	ctx: Pick<ExtensionContext, "model">,
	state: AdapterState,
): boolean {
	if (state.config.voiceFeaturesOnly) return false;
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	return isAdapterRuntime(plan) && isResponsesContext(ctx);
}

function applyCodexRuntimePayload(payload: unknown, responsesLite: boolean): unknown {
	return responsesLite && isCodeModeCompatibleBody(payload)
		? applyResponsesLiteRequest(payload)
		: payload;
}

export function rewriteCodexProviderHeaders(
	headers: ProviderHeaders,
	ctx: ExtensionContext,
	state: AdapterState,
): void {
	if (state.config.voiceFeaturesOnly) return;
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	if (plan.transport === "responses-lite") {
		headers[RESPONSES_LITE_HEADER] = "true";
	}
	if (
		plan.contextManagementRemote &&
		usesRemoteHistoryNotes(ctx, plan.contextManagementMode)
	)
		state.contextWindows.rewriteHeaders(headers, ctx);
}

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	if (!prepared) return undefined;
	const { plan, configuredPayload } = prepared;
	let rewrittenPayload = state.developerMessages.rewritePayload(configuredPayload, ctx.model);
	if (plan.contextManagement) {
		const remoteHistoryNotes = usesRemoteHistoryNotes(
			ctx,
			plan.contextManagementMode,
		);
		rewrittenPayload = rewriteContextTools(
			rewrittenPayload,
			ctx,
			plan.contextManagementRemote && remoteHistoryNotes,
		);
		if (plan.contextManagementRemote && remoteHistoryNotes)
			rewrittenPayload = state.contextWindows.rewritePayload(rewrittenPayload, ctx);
	}
	if (plan.nativeCompaction || state.pendingPiCompactionNativeWindow) {
		const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(rewrittenPayload, ctx, state);
		rewrittenPayload = piCompactionPayload ?? (await rewriteCodexCompactedProviderRequest(rewrittenPayload, ctx, state)) ?? rewrittenPayload;
	}
	const finalPayload = applyCodexRuntimePayload(
		rewrittenPayload,
		plan.transport === "responses-lite",
	);
	return finalPayload;
}

function isCodeModeCompatibleBody(value: unknown): value is ResponsesLiteCompatibleBody {
	return typeof value === "object" && value !== null
		&& typeof (value as { model?: unknown }).model === "string"
		&& Array.isArray((value as { input?: unknown }).input);
}

function rewriteContextTools(
	payload: unknown,
	ctx: Pick<ExtensionContext, "model">,
	remote: boolean,
): unknown {
	const codexTransport = (ctx.model?.api ?? "").trim().toLowerCase() ===
		"openai-codex-responses";
	return !codexTransport || remote
		? rewriteContextNamespaceTools(payload, { encrypted: remote })
		: payload;
}
