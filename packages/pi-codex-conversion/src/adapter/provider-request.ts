import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isResponsesContext } from "./prompt/codex-model.ts";
import { applyCodexRequestOptions } from "./request-options.ts";
import type { AdapterState } from "./activation/state.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "./activation/runtime-plan.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction/compaction.ts";
import { applyResponsesLiteRequest, type ResponsesLiteCompatibleBody } from "../providers/openai-codex/responses-lite.ts";

function prepareCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState) {
	if (state.config.voiceFeaturesOnly) return undefined;
	const plan = resolveCodexRuntimePlan(ctx, state.config);
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

function applyCodexRuntimePayload(payload: unknown, codeMode: boolean): unknown {
	return codeMode && isCodeModeCompatibleBody(payload) ? applyResponsesLiteRequest(payload) : payload;
}

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	if (!prepared) return undefined;
	const { plan, configuredPayload } = prepared;
	let rewrittenPayload = configuredPayload;
	if (plan.nativeCompaction || state.pendingPiCompactionNativeWindow) {
		const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(configuredPayload, ctx, state);
		rewrittenPayload = piCompactionPayload ?? (await rewriteCodexCompactedProviderRequest(configuredPayload, ctx, state)) ?? configuredPayload;
	}
	return applyCodexRuntimePayload(rewrittenPayload, plan.kind === "code");
}

export function rewriteCodexPrewarmProviderRequest(
	payload: unknown,
	ctx: ExtensionContext,
	state: AdapterState,
): unknown | undefined {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	return prepared ? applyCodexRuntimePayload(prepared.configuredPayload, prepared.plan.kind === "code") : undefined;
}

function isCodeModeCompatibleBody(value: unknown): value is ResponsesLiteCompatibleBody {
	return typeof value === "object" && value !== null
		&& typeof (value as { model?: unknown }).model === "string"
		&& Array.isArray((value as { input?: unknown }).input);
}
