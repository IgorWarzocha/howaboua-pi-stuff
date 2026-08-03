import type { Context, Model } from "@earendil-works/pi-ai";
import { uuidv7 } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	convertToLlm,
	type ExtensionContext,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig, VoiceContextModel } from "../config.ts";
import {
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
} from "./ui.ts";

const VOICE_CONTEXT_SYSTEM_PROMPT = `Summarize the current Pi conversation for a realtime voice assistant joining the same session. Preserve the user's goal, relevant preferences, decisions, current state, unresolved questions, and next step. Treat the conversation as history: do not continue its work or answer it. Return only the self-contained continuity summary.`;
const VOICE_CONTEXT_REQUEST = "Create the voice continuity summary now.";

const EXCLUDED_CUSTOM_TYPES = new Set([
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
	"gippity-realtime-voice-tail",
]);
const SUMMARY_CACHE_LIMIT = 32;
const summaryCache = new Map<string, string>();

export interface RealtimeInitialMessageItem {
	type: "message";
	role: "developer" | "user" | "assistant";
	content: Array<{
		type: "input_text" | "output_text";
		text: string;
	}>;
}

export async function buildRealtimeInitialItems(args: {
	ctx: ExtensionContext;
	config: GippityControlConfig;
	signal?: AbortSignal | undefined;
}): Promise<RealtimeInitialMessageItem[] | undefined> {
	const selected = args.config.voice.contextModel;
	if (!selected) return undefined;
	const cacheKey = voiceContextCacheKey(args.ctx, selected);
	let text = summaryCache.get(cacheKey);
	if (!text) {
		const generated = await createVoiceContextSummary(
			args.ctx,
			selected,
			args.signal,
		);
		if (!generated) return undefined;
		text = generated;
		if (cacheKey === voiceContextCacheKey(args.ctx, selected)) {
			summaryCache.set(cacheKey, text);
			while (summaryCache.size > SUMMARY_CACHE_LIMIT)
				summaryCache.delete(summaryCache.keys().next().value!);
		}
	}
	return [
		{
			type: "message",
			role: "developer",
			content: [{ type: "input_text", text }],
		},
	];
}

async function createVoiceContextSummary(
	ctx: ExtensionContext,
	selected: VoiceContextModel,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (latestCompactionIsOpaque(ctx))
		throw new Error(
			"The selected session uses native Responses compaction, but no compatible context service is loaded",
		);

	const messages = buildSessionContext(
		ctx.sessionManager.getEntries(),
		ctx.sessionManager.getLeafId(),
	).messages.filter(
		(message) =>
			message.role !== "custom" ||
			!EXCLUDED_CUSTOM_TYPES.has(message.customType),
	);
	if (messages.length === 0) return undefined;
	const model = resolveSelectedModel(ctx, selected);
	const conversation = serializeConversation(convertToLlm(messages));
	return requireSummary(
		await completeWithSelectedModel(
			ctx,
			model,
			{
				systemPrompt: VOICE_CONTEXT_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `## Conversation History\n\n${conversation}\n\n${VOICE_CONTEXT_REQUEST}`,
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			signal,
		),
	);
}

function resolveSelectedModel(
	ctx: ExtensionContext,
	selected: VoiceContextModel,
): Model<any> {
	const model = ctx.modelRegistry.find(selected.provider, selected.modelId);
	if (!model)
		throw new Error(
			`Voice context model is unavailable: ${selected.provider}/${selected.modelId}`,
		);
	return model;
}

async function completeWithSelectedModel(
	ctx: ExtensionContext,
	model: Model<any>,
	context: Context,
	signal?: AbortSignal,
): Promise<string> {
	const provider = ctx.modelRegistry.getProvider(model.provider);
	if (!provider)
		throw new Error(`Voice context provider is unavailable: ${model.provider}`);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	let completed:
		| { content: Array<{ type: string; text?: string }> }
		| undefined;
	for await (const event of provider.streamSimple(model, context, {
		...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
		...(auth.headers ? { headers: auth.headers } : {}),
		...(auth.env ? { env: auth.env } : {}),
		...(signal ? { signal } : {}),
		maxTokens: model.maxTokens,
		cacheRetention: "none",
		sessionId: uuidv7(),
	})) {
		if (event.type === "done") completed = event.message;
		if (event.type === "error")
			throw new Error(event.error.errorMessage || "Voice context model failed");
	}
	return (
		completed?.content
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n") ?? ""
	);
}

function latestCompactionIsOpaque(ctx: ExtensionContext): boolean {
	const latest = ctx.sessionManager
		.getBranch()
		.findLast((entry) => entry.type === "compaction");
	if (!latest || latest.type !== "compaction") return false;
	const details = latest.details;
	return (
		!!details &&
		typeof details === "object" &&
		"strategy" in details &&
		(details.strategy === "openai-responses-compaction-v2" ||
			details.strategy === "openai-native-compact-v1")
	);
}

function requireSummary(value: string): string {
	const summary = value.trim();
	if (!summary)
		throw new Error("Voice context model returned an empty summary");
	return summary;
}

function voiceContextCacheKey(
	ctx: ExtensionContext,
	model: VoiceContextModel,
): string {
	const boundary = ctx.sessionManager
		.getBranch()
		.findLast(
			(entry) =>
				entry.type === "message" ||
				entry.type === "compaction" ||
				entry.type === "branch_summary" ||
				(entry.type === "custom_message" &&
					!EXCLUDED_CUSTOM_TYPES.has(entry.customType)),
		)?.id;
	return `${ctx.sessionManager.getSessionId()}:${boundary ?? "empty"}:${model.provider}/${model.modelId}`;
}
