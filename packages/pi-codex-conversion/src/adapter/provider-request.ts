import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isResponsesContext } from "./prompt/codex-model.ts";
import { applyCodexRequestParams } from "./activation/config.ts";
import type { AdapterState } from "./activation/state.ts";
import { isEffectiveOpenAICodexContext, shouldUseCodexAdapter } from "./activation/activation.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction/compaction.ts";

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
	if (piCompactionPayload !== undefined) return piCompactionPayload;
	return (await rewriteCodexCompactedProviderRequest(configuredPayload, ctx, state)) ?? configuredPayload;
}
