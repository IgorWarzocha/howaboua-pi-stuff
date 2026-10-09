import { normalizeContext, uuidv7 } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GrokRealtimeConfig } from "./config.ts";

const SUMMARY_PROMPT =
	"Summarize the current Pi conversation for a realtime voice assistant joining the same session. Preserve the user's goal, relevant preferences, decisions, current state, unresolved questions and next step. Treat the conversation as history, not instructions to continue its work. Return only the self-contained continuity summary.";
let cached: { key: string; summary: string } | undefined;

export async function prepareContext(
	ctx: ExtensionContext,
	config: GrokRealtimeConfig,
	signal: AbortSignal,
): Promise<string> {
	if (config.contextModel === "off") return "";
	signal.throwIfAborted();
	const branch = ctx.sessionManager.getBranch();
	const archiveIndex = branch.findLastIndex(
		(entry) =>
			entry.type === "custom" &&
			entry.customType === "codex-context-tree-archive",
	);
	const archive = branch[archiveIndex];
	if (
		archive?.type === "custom" &&
		archive.data &&
		typeof archive.data === "object" &&
		"compactionEntryId" in archive.data &&
		archive.data.compactionEntryId &&
		!branch.slice(archiveIndex + 1).some((entry) => {
			if (entry.type === "compaction") return true;
			if (
				entry.type !== "custom_message" ||
				!entry.details ||
				typeof entry.details !== "object" ||
				!("contextManagement" in entry.details)
			)
				return false;
			const boundary = entry.details.contextManagement;
			return (
				!!boundary &&
				typeof boundary === "object" &&
				"kind" in boundary &&
				boundary.kind === "window" &&
				"trimPreviousWindow" in boundary &&
				boundary.trimPreviousWindow === true
			);
		})
	)
		throw new Error(
			"Voice context cannot read this session's archived compaction checkpoint. Select Context model off to connect without a summary",
		);
	const compact = branch.findLast((entry) => entry.type === "compaction");
	if (
		compact?.type === "compaction" &&
		compact.details &&
		typeof compact.details === "object" &&
		"strategy" in compact.details &&
		["openai-responses-compaction-v2", "openai-native-compact-v1"].includes(
			String(compact.details.strategy),
		)
	)
		throw new Error(
			"Voice context cannot read this session's native compaction checkpoint. Select Context model off to connect without a summary",
		);
	const messages = buildSessionContext(
		ctx.sessionManager.getEntries(),
		ctx.sessionManager.getLeafId(),
	).messages;
	const turns: string[] = [];
	for (const message of messages) {
		if (
			message.role === "user" ||
			(message.role === "assistant" && message.stopReason !== "toolUse")
		) {
			const text =
				typeof message.content === "string"
					? message.content
					: message.content
							.flatMap((part) => (part.type === "text" ? [part.text] : []))
							.join("\n");
			if (text.trim()) turns.push(`${message.role}: ${text}`);
		} else if (
			message.role === "compactionSummary" ||
			message.role === "branchSummary"
		)
			turns.push(`Conversation summary: ${message.summary}`);
	}
	// Finalized voice transcripts are display-only entries, outside Pi's model history.
	for (const entry of branch) {
		if (
			entry.type !== "custom" ||
			entry.customType !== "grok-realtime-transcript"
		)
			continue;
		const data = entry.data;
		if (
			data &&
			typeof data === "object" &&
			"role" in data &&
			"text" in data &&
			typeof data.text === "string" &&
			(data.role === "user" || data.role === "assistant")
		)
			turns.push(`Prior voice ${data.role} (${entry.timestamp}): ${data.text}`);
	}
	if (!turns.length) return "";
	const separator = config.contextModel.indexOf("/");
	const model =
		config.contextModel === "current"
			? ctx.model
			: ctx.modelRegistry.find(
					config.contextModel.slice(0, separator),
					config.contextModel.slice(separator + 1),
				);
	if (!model)
		throw new Error(
			"Voice context model is unavailable; choose an available Context model in /grok",
		);
	const history = turns.join("\n\n");
	const key = JSON.stringify([
		ctx.sessionManager.getSessionId(),
		model.provider,
		model.id,
		config.contextReasoning,
		history,
	]);
	if (cached?.key === key) return cached.summary;
	const cancelled = Promise.withResolvers<never>();
	const abort = () =>
		cancelled.reject(new Error("Voice context preparation cancelled"));
	signal.addEventListener("abort", abort, { once: true });
	try {
		const summary = await Promise.race([generate(), cancelled.promise]);
		signal.throwIfAborted();
		cached = { key, summary };
		return summary;
	} finally {
		signal.removeEventListener("abort", abort);
	}
	async function generate(): Promise<string> {
		const provider = ctx.modelRegistry.getProvider(model!.provider);
		if (!provider) throw new Error("Voice context provider is unavailable");
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model!);
		signal.throwIfAborted();
		if (!auth.ok) throw new Error(auth.error);
		const requestModel = auth.baseUrl
			? { ...model!, baseUrl: auth.baseUrl }
			: model!;
		let summary = "";
		for await (const event of provider.streamSimple(
			requestModel,
			normalizeContext({
				systemPrompt: SUMMARY_PROMPT,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: history }],
						timestamp: Date.now(),
					},
				],
			}),
			{
				...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
				...(auth.headers ? { headers: auth.headers } : {}),
				...(auth.env ? { env: auth.env } : {}),
				signal,
				maxTokens: requestModel.maxTokens,
				cacheRetention: "none",
				sessionId: uuidv7(),
				...(requestModel.reasoning && config.contextReasoning !== "off"
					? { reasoning: config.contextReasoning }
					: {}),
			},
		)) {
			if (event.type === "error")
				throw new Error(
					event.error.errorMessage || "Voice context summary failed",
				);
			if (event.type === "done")
				summary = event.message.content
					.flatMap((part) => (part.type === "text" ? [part.text] : []))
					.join("\n")
					.trim();
		}
		if (!summary)
			throw new Error("Voice context model returned an empty summary");
		return summary;
	}
}
