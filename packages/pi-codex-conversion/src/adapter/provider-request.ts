import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import { isResponsesContext } from "./prompt/codex-model.ts";
import { applyCodexRequestOptions } from "./request-options.ts";
import type { AdapterState } from "./activation/state.ts";
import { isAdapterRuntime, resolveCodexRuntimePlanForState } from "./activation/runtime-plan.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction/provider-replay.ts";
import { applyResponsesLiteRequest, RESPONSES_LITE_HEADER, type ResponsesLiteCompatibleBody } from "../providers/openai-codex/responses-lite.ts";
import { rewriteRelationshipHeaders, rewriteRelationshipPayload } from "../agent-relationship.ts";

function prepareCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState) {
	if (state.config.voiceFeaturesOnly) return undefined;
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	if (!isAdapterRuntime(plan) || (!plan.effectiveOpenAICodex && !isResponsesContext(ctx))) {
		return undefined;
	}
	return {
		plan,
		configuredPayload: applyCodexRequestOptions(payload, state.config, {
			modelId: ctx.model?.id,
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
	if (isAdapterRuntime(plan) && plan.effectiveOpenAICodex) rewriteRelationshipHeaders(headers, ctx);
}

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState, blockImages = false): Promise<unknown | undefined> {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	if (!prepared) return undefined;
	const { plan, configuredPayload } = prepared;
	let rewrittenPayload = state.developerMessages.rewritePayload(configuredPayload, ctx.model, blockImages);
	if (plan.nativeReplay || state.pendingPiCompactionNativeWindow) {
		const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(rewrittenPayload, ctx, state);
		rewrittenPayload = piCompactionPayload ?? (await rewriteCodexCompactedProviderRequest(rewrittenPayload, ctx, state)) ?? rewrittenPayload;
	}
	const finalPayload = applyCodexRuntimePayload(
		rewrittenPayload,
		plan.transport === "responses-lite",
	);
	return plan.effectiveOpenAICodex ? rewriteRelationshipPayload(finalPayload, ctx) : finalPayload;
}

function isCodeModeCompatibleBody(value: unknown): value is ResponsesLiteCompatibleBody {
	return typeof value === "object" && value !== null
		&& typeof (value as { model?: unknown }).model === "string"
		&& Array.isArray((value as { input?: unknown }).input);
}
