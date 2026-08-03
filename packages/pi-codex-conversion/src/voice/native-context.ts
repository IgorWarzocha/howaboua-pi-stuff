import { uuidv7, type Context, type Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeBaseUrl } from "../adapter/compaction/compaction-runtime.ts";
import { findLatestCompactionEntryIndex } from "../adapter/compaction/details-store.ts";
import { normalizeRemoteCompactionV2PromptInput } from "../adapter/compaction/remote-v2-history.ts";
import { serializeLiveTailToResponsesInput } from "../adapter/replay/payload-rewrite.ts";
import {
	isNativeCompactionEntry,
	type NativeCompactionEntry,
} from "../adapter/compaction/types.ts";

interface VoiceContextModelSelection {
	provider: string;
	modelId: string;
}

interface NativeVoiceContextRequest {
	ctx: ExtensionContext;
	model: VoiceContextModelSelection;
	systemPrompt: string;
	request: string;
	signal?: AbortSignal | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function createNativeVoiceContextSummary(
	request: NativeVoiceContextRequest,
): Promise<string> {
	const branch = request.ctx.sessionManager.getBranch();
	const checkpointIndex = findLatestCompactionEntryIndex(branch);
	if (checkpointIndex === undefined)
		throw new Error("Native checkpoint is missing from the active branch");
	const checkpoint = branch[checkpointIndex];
	if (!isNativeCompactionEntry(checkpoint))
		throw new Error(
			"The latest compaction is not a native Responses checkpoint",
		);
	const details = checkpoint.details;
	if (!details) throw new Error("Native checkpoint details are missing");
	const model = request.ctx.modelRegistry.find(
		request.model.provider,
		request.model.modelId,
	);
	if (!model)
		throw new Error(
			`Voice context model is unavailable: ${request.model.provider}/${request.model.modelId}`,
		);
	assertCheckpointCompatibility(model, details);
	const provider = request.ctx.modelRegistry.getProvider(model.provider);
	if (!provider)
		throw new Error(`Voice context provider is unavailable: ${model.provider}`);
	const auth = await request.ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);

	const liveTail = serializeLiveTailToResponsesInput({
		model,
		entries: branch.slice(checkpointIndex + 1),
	});
	const context: Context = {
		systemPrompt: request.systemPrompt,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: request.request }],
				timestamp: Date.now(),
			},
		],
	};
	let completed:
		| { content: Array<{ type: string; text?: string }>; errorMessage?: string }
		| undefined;
	for await (const event of provider.streamSimple(model, context, {
		...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
		...(auth.headers ? { headers: auth.headers } : {}),
		...(auth.env ? { env: auth.env } : {}),
		...(request.signal ? { signal: request.signal } : {}),
		maxTokens: model.maxTokens,
		cacheRetention: "none",
		sessionId: uuidv7(),
		onPayload(payload) {
			if (!isRecord(payload) || !Array.isArray(payload["input"]))
				throw new Error(
					"Voice context model did not produce a Responses-compatible request",
				);
			const input = normalizeRemoteCompactionV2PromptInput([
				...details.compactedWindow,
				...liveTail,
				...payload["input"],
			]);
			return {
				...payload,
				input,
				prompt_cache_key: request.ctx.sessionManager.getSessionId(),
			};
		},
	})) {
		if (event.type === "done") completed = event.message;
		if (event.type === "error")
			throw new Error(event.error.errorMessage || "Voice context model failed");
	}
	const summary =
		completed?.content
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n")
			.trim() ?? "";
	if (!summary)
		throw new Error("Voice context model returned an empty summary");
	return summary;
}

function assertCheckpointCompatibility(
	model: Model<any>,
	details: NonNullable<NativeCompactionEntry["details"]>,
): void {
	const baseUrl = normalizeBaseUrl(model.baseUrl);
	if (
		model.provider !== details.provider ||
		model.api !== details.api ||
		baseUrl !== normalizeBaseUrl(details.baseUrl)
	)
		throw new Error(
			`Voice context model ${model.provider}/${model.id} cannot read the latest native checkpoint; choose a ${details.provider} Responses model on ${details.baseUrl}`,
		);
}
