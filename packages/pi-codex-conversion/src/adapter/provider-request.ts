import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isOpenAICodexContext, isResponsesContext } from "./prompt/codex-model.ts";
import { applyCodexRequestParams } from "./activation/config.ts";
import type { AdapterState } from "./activation/state.ts";
import { isEffectiveOpenAICodexContext, shouldUseCodexAdapter, shouldUseGpt56CodeMode, shouldUseResponsesLiteForCodeMode, supportsProxiedGpt56CodeModeModel } from "./activation/activation.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction/compaction.ts";
import { applyResponsesLiteRequest, supportsResponsesLiteModel, type ResponsesLiteCompatibleBody } from "../providers/openai-codex/responses-lite.ts";
import { applyCodeModeFreeformContract } from "./code-mode-contract.ts";

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	if (!shouldUseCodexAdapter(ctx, state.config) || (!isEffectiveOpenAICodexContext(ctx, state.config) && !isResponsesContext(ctx))) {
		return undefined;
	}

	const isEffectiveOpenAICodex = isEffectiveOpenAICodexContext(ctx, state.config);
	const configuredPayload = applyCodexRequestParams(payload, state.config, {
		serviceTier: isEffectiveOpenAICodex,
		verbosity: true,
	});
	const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(configuredPayload, ctx, state);
	const rewrittenPayload = piCompactionPayload ?? (await rewriteCodexCompactedProviderRequest(configuredPayload, ctx, state)) ?? configuredPayload;
	if (
		shouldUseGpt56CodeMode(ctx, state.config)
		&& isCodeModeCompatibleBody(rewrittenPayload)
		&& (isOpenAICodexContext(ctx)
			? supportsResponsesLiteModel(rewrittenPayload.model)
			: supportsProxiedGpt56CodeModeModel(rewrittenPayload.model))
	) {
		const codeModePayload = applyCodeModeFreeformContract(rewrittenPayload);
		return shouldUseResponsesLiteForCodeMode(ctx, state.config)
			? applyResponsesLiteRequest(codeModePayload)
			: codeModePayload;
	}
	return rewrittenPayload;
}

function isCodeModeCompatibleBody(value: unknown): value is ResponsesLiteCompatibleBody {
	return typeof value === "object" && value !== null
		&& typeof (value as { model?: unknown }).model === "string"
		&& Array.isArray((value as { input?: unknown }).input);
}
