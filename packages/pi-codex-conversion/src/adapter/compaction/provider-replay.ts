import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { resolveLatestNativeCompactionEntry } from "./details-store.ts";
import { rewriteResponsesPayloadWithNativeReplay } from "../replay/payload-rewrite.ts";
import { DEFAULT_SUPPORTED_PROVIDERS, isResponsesCompatiblePayload, resolveNativeCompactionEnvironment, type ResponsesCompatibleRequestPayload } from "./compaction-runtime.ts";
import { serializeMessagesToResponsesInput, type ResponsesInputItem } from "./serializer.ts";
import { hasPortableNativeCompactionSummary, type NativeCompactionEntry } from "./types.ts";
import { resolveCodexRuntimePlanForState } from "../activation/runtime-plan.ts";
import type { AdapterState } from "../activation/state.ts";
import { CODE_MODE_EXEC_GRAMMAR_INPUTS } from "../../tools/code-mode/exec-contract.ts";
import { createCompactionSummaryAgentMessage } from "../replay/native-replay-matching.ts";
import { areEquivalentValues } from "../replay/payload-structured.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveOpaqueNativeCompactionFallbackEntry(
	branchEntries: readonly SessionEntry[],
	runtime: { provider: string; api: string; baseUrl: string },
): NativeCompactionEntry | undefined {
	const latest = resolveLatestNativeCompactionEntry(branchEntries, runtime);
	return latest.ok && !hasPortableNativeCompactionSummary(latest.entry)
		? latest.entry
		: undefined;
}

export function stashLatestNativeWindowForPiCompactionFallback(
	ctx: ExtensionContext,
	branchEntries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>,
	runtime: { provider: string; api: string; baseUrl: string },
	state: AdapterState,
): boolean {
	state.pendingPiCompactionNativeWindow = undefined;
	const nativeEntry = resolveOpaqueNativeCompactionFallbackEntry(branchEntries, runtime);
	const compactedWindow = cloneCompactedWindow(nativeEntry?.details?.compactedWindow ?? []);
	if (!compactedWindow || compactedWindow.length === 0) return false;
	state.pendingPiCompactionNativeWindow = {
		window: compactedWindow,
		provider: runtime.provider,
		api: runtime.api,
		baseUrl: runtime.baseUrl,
		sessionId: ctx.sessionManager.getSessionId(),
		sourceCompactionEntryId: nativeEntry?.id,
	};
	return true;
}

function cloneCompactedWindow(window: readonly unknown[]): ResponsesInputItem[] | undefined {
	if (!window.every(isRecord)) return undefined;
	return window.filter((item) => item["type"] !== "configuration_update").map((item) => structuredClone(item));
}

function textFromResponsesContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => isRecord(item) && item["type"] === "input_text" && typeof item["text"]! === "string" ? item["text"]! : "")
		.join("\n");
}

function isPiCompactionSummarizationPayload(payload: ResponsesCompatibleRequestPayload): boolean {
	const instructions = typeof payload.instructions === "string" ? payload.instructions : "";
	if (/compact|summar/i.test(instructions)) return true;

	return payload.input.some((item) => {
		if (!isRecord(item)) return false;
		const role = item["role"]!;
		const text = textFromResponsesContent(item["content"]!);
		if ((role === "system" || role === "developer") && /compact|summar/i.test(text)) return true;
		if (role === "user" && /<conversation>|previous compaction summary|summary/i.test(text)) return true;
		return false;
	});
}

export function getSupportedNativeCompactionProviders(state: AdapterState): string[] {
	return [...new Set([...DEFAULT_SUPPORTED_PROVIDERS, ...state.config.scope.additionalProviders])];
}

export async function rewriteCodexCompactedProviderRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	if (!plan.nativeReplay) return undefined;
	const selected = state.replayCompaction;
	if (!selected || selected.sessionId !== ctx.sessionManager.getSessionId()) return undefined;
	const branch = ctx.sessionManager.getBranch();
	const branchEntries = branch.some(entry => entry.id === selected.entryId)
		? branch : ctx.sessionManager.getBranch(selected.entryId);
	// A newer Pi checkpoint retires native replay regardless of the next selected method.
	if (!resolveLatestNativeCompactionEntry(branchEntries).ok) return undefined;
	const resolution = await resolveNativeCompactionEnvironment(ctx, { enabled: true, supportedProviders: getSupportedNativeCompactionProviders(state) }, payload);
	if (!resolution.ok) return undefined;
	const runtime = resolution.runtime;
	const latest = resolveLatestNativeCompactionEntry(branchEntries, {
		provider: runtime.provider,
		api: runtime.api,
		baseUrl: runtime.baseUrl,
	});
	if (!latest.ok) return undefined;
	if (!runtime.payload) return undefined;
	// A context transform may retire the checkpoint without changing stored history.
	// Only replace a summary still present in the actual provider request.
	const summary = serializeMessagesToResponsesInput(runtime.currentModel, [createCompactionSummaryAgentMessage(latest.entry)]);
	if (!summary.length || !runtime.payload.input.some((_, index) =>
		areEquivalentValues(runtime.payload!.input.slice(index, index + summary.length), summary))) return undefined;
	const rewrite = rewriteResponsesPayloadWithNativeReplay({
		model: runtime.currentModel,
		payload: runtime.payload,
		branchEntries,
		compactionEntry: latest.entry,
		serializationOptions: {
			...(plan.transport === "responses-lite" ? { grammarToolInputProperties: CODE_MODE_EXEC_GRAMMAR_INPUTS } : {}),
		},
	});
	if (rewrite.ok) return rewrite.rewrittenPayload;
	const detail = rewrite.parity?.mismatches.slice(0, 3).join("; ");
	const message = `OpenAI native compaction replay failed (${rewrite.reason})${detail ? `: ${detail}` : ""}; request was not sent with placeholder compaction context.`;
	ctx.ui.notify(message, "error");
	throw new Error(message);
}

export async function injectPendingNativeWindowIntoPiCompactionRequest(payload: unknown, ctx: ExtensionContext, state: AdapterState): Promise<unknown | undefined> {
	const pending = state.pendingPiCompactionNativeWindow;
	if (!pending || pending.window.length === 0) return undefined;
	if (!isResponsesCompatiblePayload(payload)) return undefined;
	if (pending.sessionId !== ctx.sessionManager.getSessionId()) {
		state.pendingPiCompactionNativeWindow = undefined;
		return undefined;
	}
	if (!isPiCompactionSummarizationPayload(payload)) return undefined;

	const resolution = await resolveNativeCompactionEnvironment(ctx, { enabled: true, supportedProviders: getSupportedNativeCompactionProviders(state) }, payload);
	if (!resolution.ok) return undefined;
	const runtime = resolution.runtime;
	if (pending.provider !== runtime.provider || pending.api !== runtime.api || pending.baseUrl !== runtime.baseUrl) {
		state.pendingPiCompactionNativeWindow = undefined;
		return undefined;
	}

	const input = [...payload.input];
	let insertAt = 0;
	while (insertAt < input.length) {
		const item = input[insertAt]!;
		if (!isRecord(item) || (item["role"] !== "system" && item["role"] !== "developer")) break;
		insertAt++;
	}

	state.pendingPiCompactionNativeWindow = undefined;
	return {
		...payload,
		input: [
			...input.slice(0, insertAt),
			...pending.window.map((item) => structuredClone(item)),
			...input.slice(insertAt),
		],
	};
}
