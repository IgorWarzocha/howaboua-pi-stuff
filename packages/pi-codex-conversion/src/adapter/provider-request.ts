import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isOpenAICodexContext, isResponsesContext } from "./codex-model.ts";
import { applyCodexRequestParams } from "./config.ts";
import type { AdapterState } from "./state.ts";
import { rewriteNativeImageGenerationTool } from "../tools/image-generation-tool.ts";
import { rewriteNativeWebSearchTool } from "../tools/web-search-tool.ts";
import { isEffectiveOpenAICodexContext, shouldUseCodexAdapter, shouldUseProxyNativeTools } from "./activation.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction.ts";

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	if (!shouldUseCodexAdapter(ctx, state.config) || (!isEffectiveOpenAICodexContext(ctx, state.config) && !isResponsesContext(ctx))) {
		return undefined;
	}

	const useProxyNativeTools = !isOpenAICodexContext(ctx) && shouldUseProxyNativeTools(ctx, state.config);
	const isEffectiveOpenAICodex = isEffectiveOpenAICodexContext(ctx, state.config);
	const webSearchPayload = isEffectiveOpenAICodex && state.config.webSearch
		? rewriteNativeWebSearchTool(payload, ctx.model, { force: useProxyNativeTools })
		: payload;
	const imageGenerationPayload = isEffectiveOpenAICodex && state.config.imageGeneration
		? rewriteNativeImageGenerationTool(webSearchPayload, ctx.model, { force: useProxyNativeTools })
		: webSearchPayload;
	const configuredPayload = applyCodexRequestParams(imageGenerationPayload, state.config, {
		serviceTier: isEffectiveOpenAICodex,
		verbosity: true,
	});
	const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(configuredPayload, ctx, state);
	if (piCompactionPayload !== undefined) return piCompactionPayload;
	return (await rewriteCodexCompactedProviderRequest(configuredPayload, ctx, state)) ?? configuredPayload;
}
