import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import { isResponsesContext } from "./prompt/model-support.ts";
import { applyCodexRequestOptions } from "./request-options.ts";
import type { AdapterState } from "./activation/state.ts";
import {
	isAdapterRuntime,
	resolveAdapterRuntimePlanForState,
} from "./activation/runtime-plan.ts";
import {
	injectPendingNativeWindowIntoPiCompactionRequest,
	rewriteCodexCompactedProviderRequest,
} from "./compaction/provider-replay.ts";
import { hiddenPiReplacementToolNames } from "./activation/tool-set.ts";
import {
	applyResponsesLiteRequest,
	RESPONSES_LITE_HEADER,
	type ResponsesLiteCompatibleBody,
} from "../providers/openai-codex/responses-lite.ts";
import {
	rewriteRelationshipHeaders,
	rewriteRelationshipPayload,
} from "../agent-relationship.ts";

function prepareCodexProviderRequest(
	payload: unknown,
	ctx: ExtensionContext,
	state: AdapterState,
) {
	const plan = resolveAdapterRuntimePlanForState(ctx, state);
	if (
		!isAdapterRuntime(plan) ||
		(!plan.codexOrConfiguredResponses && !isResponsesContext(ctx))
	) {
		return undefined;
	}
	return {
		plan,
		configuredPayload: applyCodexRequestOptions(payload, state.config, {
			modelId: ctx.model?.id,
			serviceTier: plan.codexOrConfiguredResponses,
			verbosity: true,
		}),
	};
}

export function supportsCodexDeveloperMessages(
	ctx: Pick<ExtensionContext, "model">,
	state: AdapterState,
): boolean {
	const plan = resolveAdapterRuntimePlanForState(ctx, state);
	return isAdapterRuntime(plan) && isResponsesContext(ctx);
}

function applyCodexRuntimePayload(
	payload: unknown,
	responsesLite: boolean,
): unknown {
	return responsesLite && isCodeModeCompatibleBody(payload)
		? applyResponsesLiteRequest(payload)
		: payload;
}

export function rewriteCodexProviderHeaders(
	headers: ProviderHeaders,
	ctx: ExtensionContext,
	state: AdapterState,
): void {
	const plan = resolveAdapterRuntimePlanForState(ctx, state);
	if (plan.responsesFormat === "responses-lite") {
		headers[RESPONSES_LITE_HEADER] = "true";
	}
	if (isAdapterRuntime(plan) && plan.codexOrConfiguredResponses)
		rewriteRelationshipHeaders(headers, ctx);
}

export async function rewriteCodexProviderRequest(
	payload: unknown,
	ctx: ExtensionContext,
	state: AdapterState,
	activeTools: readonly string[],
	blockImages = false,
): Promise<unknown | undefined> {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	if (!prepared) return undefined;
	const { plan, configuredPayload } = prepared;
	let rewrittenPayload = state.developerMessages.rewritePayload(
		configuredPayload,
		ctx.model,
		blockImages,
	);
	if (plan.nativeReplay || state.pendingPiCompactionNativeWindow) {
		const piCompactionPayload =
			await injectPendingNativeWindowIntoPiCompactionRequest(
				rewrittenPayload,
				ctx,
				state,
			);
		rewrittenPayload =
			piCompactionPayload ??
			(await rewriteCodexCompactedProviderRequest(
				rewrittenPayload,
				ctx,
				state,
				hiddenPiReplacementToolNames(state.appliedRuntimeKind, activeTools),
			)) ??
			rewrittenPayload;
	}
	const finalPayload = applyCodexRuntimePayload(
		rewrittenPayload,
		plan.responsesFormat === "responses-lite",
	);
	return plan.codexOrConfiguredResponses
		? rewriteRelationshipPayload(finalPayload, ctx)
		: finalPayload;
}

function isCodeModeCompatibleBody(
	value: unknown,
): value is ResponsesLiteCompatibleBody {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { model?: unknown }).model === "string" &&
		Array.isArray((value as { input?: unknown }).input)
	);
}
