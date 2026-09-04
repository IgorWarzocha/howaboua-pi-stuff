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
		configuredPayload: applyCodexRequestOptions(applyVoiceSystemPrompt(payload, state.voiceSystemPromptOverride), state.config, {
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

function applyVoiceSystemPrompt(payload: unknown, systemPrompt: string | undefined): unknown {
	if (!systemPrompt || !isRecord(payload)) return payload;
	return { ...payload, instructions: systemPrompt };
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

export function captureActiveProviderSystemPrompt(payload: unknown, state: AdapterState): void {
	if (!isRecord(payload)) return;
	const instructions = providerSystemPrompt(payload);
	if (instructions !== undefined) state.activeProviderSystemPrompt = instructions;
}

export async function rewriteCodexProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	if (!prepared) return undefined;
	const { plan, configuredPayload } = prepared;
	let rewrittenPayload = state.developerMessages.rewritePayload(configuredPayload);
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
	// Stock Responses providers and configured Code Mode overlays have no
	// post-serialization callback. Keep native replay on the instructions that
	// reached this final hook boundary; the custom Codex provider captures again
	// after its transport-specific transforms.
	if (state.pendingActiveProviderPromptCapture) captureActiveProviderSystemPrompt(finalPayload, state);
	return finalPayload;
}

export function rewriteCodexPrewarmProviderRequest(
	payload: unknown,
	ctx: ExtensionContext,
	state: AdapterState,
): unknown | undefined {
	const prepared = prepareCodexProviderRequest(payload, ctx, state);
	if (!prepared) return undefined;
	let rewritten = state.developerMessages.rewritePayload(
		prepared.configuredPayload,
	);
	if (prepared.plan.contextManagement) {
		const remoteHistoryNotes = usesRemoteHistoryNotes(
			ctx,
			prepared.plan.contextManagementMode,
		);
		rewritten = rewriteContextTools(
			rewritten,
			ctx,
			prepared.plan.contextManagementRemote && remoteHistoryNotes,
		);
		if (prepared.plan.contextManagementRemote && remoteHistoryNotes)
			rewritten = state.contextWindows.rewritePayload(rewritten, ctx);
	}
	return applyCodexRuntimePayload(
		rewritten,
		prepared.plan.transport === "responses-lite",
	);
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
