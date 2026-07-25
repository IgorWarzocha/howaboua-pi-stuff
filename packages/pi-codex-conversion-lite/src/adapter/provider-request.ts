import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isResponsesContext } from "./prompt/codex-model.ts";
import { applyCodexRequestOptions } from "./request-options.ts";
import type { AdapterState } from "./activation/state.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "./activation/runtime-plan.ts";
import { applyResponsesLiteRequest, type ResponsesLiteCompatibleBody } from "../providers/openai-codex/responses-lite.ts";

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	if (state.config.voiceFeaturesOnly) return undefined;
	const plan = resolveCodexRuntimePlan(ctx, state.config);
	if (!isAdapterRuntime(plan) || (!plan.effectiveOpenAICodex && !isResponsesContext(ctx))) {
		return undefined;
	}

	const configuredPayload = applyCodexRequestOptions(payload, state.config, {
		serviceTier: plan.effectiveOpenAICodex,
		verbosity: true,
	});
	let rewrittenPayload = configuredPayload;
	if (plan.nativeCompaction || state.pendingPiCompactionNativeWindow) {
		const { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } = await import("./compaction/compaction.ts");
		const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(configuredPayload, ctx, state);
		rewrittenPayload = piCompactionPayload ?? (await rewriteCodexCompactedProviderRequest(configuredPayload, ctx, state)) ?? configuredPayload;
	}
	if (plan.kind === "code" && isCodeModeCompatibleBody(rewrittenPayload)) {
		return applyResponsesLiteRequest(rewrittenPayload);
	}
	return rewrittenPayload;
}

function isCodeModeCompatibleBody(value: unknown): value is ResponsesLiteCompatibleBody {
	return typeof value === "object" && value !== null
		&& typeof (value as { model?: unknown }).model === "string"
		&& Array.isArray((value as { input?: unknown }).input);
}
