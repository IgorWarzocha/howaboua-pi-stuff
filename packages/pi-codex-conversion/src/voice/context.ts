import { type Context, type Model, uuidv7 } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	CodexConversionConfig,
	VoiceContextModel,
} from "../adapter/activation/config.ts";
import { createNativeVoiceContextSummary } from "./native-context.ts";
import { REALTIME_DELEGATION_MESSAGE_TYPE } from "./ui.ts";

const VOICE_CONTEXT_SYSTEM_PROMPT = `Summarize the current Pi conversation for a realtime voice assistant joining the same session. Preserve the user's goal, relevant preferences, decisions, current state, unresolved questions, and next step. Treat the conversation as history: do not continue its work or answer it. Return only the self-contained continuity summary.`;
const VOICE_CONTEXT_REQUEST = "Create the voice continuity summary now.";
const VOICE_STARTUP_CONTEXT_HEADER = `Startup context from Pi.
This is background context from the current Pi conversation before realtime voice started. It may be summarized. Use it to answer questions about the earlier conversation, and do not repeat it unless relevant.`;
const SUMMARIZABLE_CUSTOM_TYPES = new Set([
	REALTIME_DELEGATION_MESSAGE_TYPE,
	"codex-realtime-voice-tail",
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
	config: CodexConversionConfig;
	onSummary?: ((summary: string) => void) | undefined;
	signal?: AbortSignal | undefined;
}): Promise<RealtimeInitialMessageItem[] | undefined> {
	const selected = args.config.voice.contextModel;
	if (!selected) return undefined;
	const reasoning = args.config.voice.contextReasoning;
	const cacheKey = voiceContextCacheKey(args.ctx, selected, reasoning);
	let text = summaryCache.get(cacheKey);
	if (!text) {
		const generated = await createVoiceContextSummary(
			args.ctx,
			selected,
			reasoning,
			args.signal,
		);
		if (!generated) return undefined;
		text = generated;
		if (cacheKey === voiceContextCacheKey(args.ctx, selected, reasoning)) {
			summaryCache.set(cacheKey, text);
			while (summaryCache.size > SUMMARY_CACHE_LIMIT)
				summaryCache.delete(summaryCache.keys().next().value!);
		}
	}
	args.onSummary?.(text);
	return [
		{
			type: "message",
			role: "developer",
			content: [{ type: "input_text", text: renderVoiceStartupContext(text) }],
		},
	];
}

function renderVoiceStartupContext(summary: string): string {
	return `${VOICE_STARTUP_CONTEXT_HEADER}\n<startup_context>\n${summary}\n</startup_context>`;
}

async function createVoiceContextSummary(
	ctx: ExtensionContext,
	selected: VoiceContextModel,
	reasoning: CodexConversionConfig["voice"]["contextReasoning"],
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (latestCompactionIsOpaque(ctx))
		return requireSummary(
			await createNativeVoiceContextSummary({
				ctx,
				model: { ...selected, reasoning },
				systemPrompt: VOICE_CONTEXT_SYSTEM_PROMPT,
				request: VOICE_CONTEXT_REQUEST,
				...(signal ? { signal } : {}),
			}),
		);

	const messages = buildSessionContext(
		ctx.sessionManager.getEntries(),
		ctx.sessionManager.getLeafId(),
	).messages;
	const conversation = serializeVoiceConversation(messages);
	if (!conversation) return undefined;
	const model = resolveSelectedModel(ctx, selected);
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
			reasoning,
			signal,
		),
	);
}

function serializeVoiceConversation(
	messages: ReturnType<typeof buildSessionContext>["messages"],
): string {
	const turns: string[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			appendTurn(turns, "User", textContent(message.content));
			continue;
		}
		if (message.role === "assistant") {
			if (message.stopReason !== "toolUse")
				appendTurn(turns, "Assistant", textContent(message.content));
			continue;
		}
		if (message.role === "compactionSummary") {
			appendTurn(turns, "Conversation summary", message.summary);
			continue;
		}
		if (message.role === "branchSummary") {
			appendTurn(turns, "Branch summary", message.summary);
			continue;
		}
		if (
			message.role === "custom" &&
			SUMMARIZABLE_CUSTOM_TYPES.has(message.customType)
		)
			appendTurn(turns, "Realtime voice", textContent(message.content));
	}
	return turns.join("\n\n");
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				!!part &&
				typeof part === "object" &&
				"type" in part &&
				part.type === "text" &&
				"text" in part &&
				typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function appendTurn(turns: string[], label: string, text: string): void {
	if (text) turns.push(`[${label}]: ${text}`);
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
	reasoning: CodexConversionConfig["voice"]["contextReasoning"],
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
		...(model.reasoning && reasoning !== "off" ? { reasoning } : {}),
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
	reasoning: CodexConversionConfig["voice"]["contextReasoning"],
): string {
	const boundary = ctx.sessionManager
		.getBranch()
		.findLast(
			(entry) =>
				entry.type === "message" ||
				entry.type === "compaction" ||
				entry.type === "branch_summary" ||
				(entry.type === "custom_message" &&
					SUMMARIZABLE_CUSTOM_TYPES.has(entry.customType)),
		)?.id;
	return `${ctx.sessionManager.getSessionId()}:${boundary ?? "empty"}:${model.provider}/${model.modelId}:${reasoning}`;
}
