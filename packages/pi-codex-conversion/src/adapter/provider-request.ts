import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isOpenAICodexContext, isResponsesContext } from "./codex-model.ts";
import { applyCodexRequestParams } from "./config.ts";
import type { AdapterState } from "./state.ts";
import { rewriteNativeImageGenerationTool } from "../tools/image-generation-tool.ts";
import { rewriteNativeWebSearchTool } from "../tools/web-search-tool.ts";
import { isConfiguredAdapterProvider, shouldUseCodexAdapter } from "./activation.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction.ts";

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	if (!shouldUseCodexAdapter(ctx, state.config) || (!isOpenAICodexContext(ctx) && !isResponsesContext(ctx))) {
		return undefined;
	}

	const isOpenAICodex = isOpenAICodexContext(ctx);
	const useProxyNativeTools = !isOpenAICodex && isConfiguredAdapterProvider(ctx, state.config) && state.config.adapterProviderCodexTools;
	const webSearchPayload = (isOpenAICodex || useProxyNativeTools) && state.config.webSearch
		? rewriteNativeWebSearchTool(payload, ctx.model, { force: useProxyNativeTools })
		: payload;
	const imageGenerationPayload = (isOpenAICodex || (useProxyNativeTools && Array.isArray(ctx.model?.input) && ctx.model.input.includes("image"))) && state.config.imageGeneration
		? rewriteNativeImageGenerationTool(webSearchPayload, ctx.model, { force: useProxyNativeTools })
		: webSearchPayload;
	const configuredPayload = applyCodexRequestParams(imageGenerationPayload, state.config, {
		serviceTier: isOpenAICodex,
		verbosity: true,
	});
	const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(configuredPayload, ctx, state);
	if (piCompactionPayload !== undefined) return piCompactionPayload;
	return (await rewriteCodexCompactedProviderRequest(configuredPayload, ctx, state)) ?? configuredPayload;
}
