import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import { isCanonicalCodexAliasModel, isCanonicalCodexBaseUrl, isResponsesContext } from "./prompt/codex-model.ts";
import { applyCodexRequestOptions } from "./request-options.ts";
import type { AdapterState } from "./activation/state.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "./activation/runtime-plan.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction/compaction.ts";
import { applyResponsesLiteRequest, RESPONSES_LITE_HEADER, type ResponsesLiteCompatibleBody } from "../providers/openai-codex/responses-lite.ts";

function prepareCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState) {
	if (state.config.voiceFeaturesOnly) return undefined;
	const plan = resolveCodexRuntimePlan(ctx, state.config);
	if (!isAdapterRuntime(plan) || (!plan.effectiveOpenAICodex && !isResponsesContext(ctx))) {
		return undefined;
	}
	return {
		plan,
		configuredPayload: applyCodexRequestOptions(applyVoiceSystemPrompt(payload, state.voiceSystemPromptOverride), state.config, {
			serviceTier: plan.effectiveOpenAICodex,
			verbosity: true,
		}),
	};
}

function applyVoiceSystemPrompt(payload: unknown, systemPrompt: string | undefined): unknown {
	if (!systemPrompt || !isRecord(payload)) return payload;
	return { ...payload, instructions: systemPrompt };
}

function applyCodexRuntimePayload(payload: unknown, codeMode: boolean): unknown {
	return codeMode && isCodeModeCompatibleBody(payload) ? applyResponsesLiteRequest(payload) : payload;
}

function canonicalAliasModelKey(model: NonNullable<ExtensionContext["model"]>): string {
	return JSON.stringify([model.provider, model.api, model.id, model.baseUrl]);
}

export async function prepareCanonicalAliasEndpoint(ctx: ExtensionContext, state: AdapterState): Promise<boolean> {
	const model = ctx.model;
	if (!model || !isCanonicalCodexAliasModel(model)) {
		state.canonicalAliasEndpoint = undefined;
		return true;
	}
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	const trusted = auth.ok && isCanonicalCodexBaseUrl(auth.baseUrl ?? model.baseUrl);
	state.canonicalAliasEndpoint = { modelKey: canonicalAliasModelKey(model), trusted };
	return trusted;
}

function hasCanonicalAliasEndpoint(ctx: ExtensionContext, state: AdapterState): boolean {
	const model = ctx.model;
	if (!model || !isCanonicalCodexAliasModel(model)) return true;
	const endpoint = state.canonicalAliasEndpoint;
	return endpoint?.modelKey === canonicalAliasModelKey(model) && endpoint.trusted;
}

export function rewriteCodexProviderHeaders(
	headers: ProviderHeaders,
	ctx: ExtensionContext,
	state: AdapterState,
): void {
	if (state.config.voiceFeaturesOnly) return;
	if (isCanonicalCodexAliasModel(ctx.model)
		&& resolveCodexRuntimePlan(ctx, state.config).kind === "code"
		&& hasCanonicalAliasEndpoint(ctx, state)) {
		headers[RESPONSES_LITE_HEADER] = "true";
	}
}

export function captureActiveProviderSystemPrompt(payload: unknown, state: AdapterState): void {
	if (!isRecord(payload)) return;
	const instructions = providerSystemPrompt(payload);
	if (instructions !== undefined) state.activeProviderSystemPrompt = instructions;
}

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	if (!prepared) return undefined;
	if (!hasCanonicalAliasEndpoint(ctx, state)) return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerSystemPrompt(payload: Record<string, unknown>): string | undefined {
	if (typeof payload["instructions"] === "string") return payload["instructions"];
	if (!Array.isArray(payload["input"])) return undefined;
	for (const item of payload["input"]) {
		if (!isRecord(item) || item["role"] !== "developer" || !Array.isArray(item["content"])) continue;
		const text = item["content"]
			.filter((part): part is Record<string, unknown> => isRecord(part) && part["type"] === "input_text" && typeof part["text"] === "string")
			.map((part) => part["text"] as string)
			.join("\n");
		if (text !== "") return text;
	}
	return undefined;
}
