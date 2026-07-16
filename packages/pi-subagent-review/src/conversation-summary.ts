import type {
	AssistantMessage,
	Credential,
	CredentialStore,
} from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionCommandContext,
	getAgentDir,
	ModelRuntime,
	readStoredCredential,
	type SessionEntry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedReviewConfig } from "./types.js";

const SUMMARY_SYSTEM_PROMPT =
	"Summarize supplied conversation context for a separate code-review agent. Follow the user's summary format exactly and do not use tools.";

function summaryCredentialStore(
	providerId: string,
	credential: Credential | undefined,
): CredentialStore {
	const credentials = new Map<string, Credential>();
	if (credential) credentials.set(providerId, credential);
	return {
		async read(id) {
			return credentials.get(id);
		},
		async list() {
			return [...credentials].map(([id, credential]) => ({
				providerId: id,
				type: credential.type,
			}));
		},
		async modify(id, update) {
			const current = credentials.get(id);
			const next = await update(current);
			if (next) credentials.set(id, next);
			return next ?? current;
		},
		async delete(id) {
			credentials.delete(id);
		},
	};
}

function lastAssistantMessage(
	messages: readonly unknown[],
): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (
			message &&
			typeof message === "object" &&
			(message as { role?: unknown }).role === "assistant"
		) {
			return message as AssistantMessage;
		}
	}
	return undefined;
}

async function completeSummary(
	ctx: ExtensionCommandContext,
	config: ResolvedReviewConfig,
	prompt: string,
): Promise<AssistantMessage> {
	const signal = ctx.signal;
	if (signal?.aborted) throw new Error("Summary model was aborted");

	const parsed = config.summary.modelParsed;
	const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
	if (!model)
		throw new Error(`Summary model not found: ${config.summary.model}`);
	const requestAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!requestAuth.ok) throw new Error(requestAuth.error);
	const persistedCredential = readStoredCredential(model.provider);
	const storedCredential =
		persistedCredential?.type === "oauth" &&
		persistedCredential.access === requestAuth.apiKey
			? persistedCredential
			: undefined;
	const resolvedCredential =
		requestAuth.apiKey || requestAuth.env
			? {
					type: "api_key" as const,
					...(requestAuth.apiKey ? { key: requestAuth.apiKey } : {}),
					...(requestAuth.env ? { env: requestAuth.env } : {}),
				}
			: undefined;
	const modelRuntime = await ModelRuntime.create({
		credentials: summaryCredentialStore(
			model.provider,
			storedCredential ?? resolvedCredential,
		),
		allowModelNetwork: false,
	});
	const registeredProvider = ctx.modelRegistry.getRegisteredProviderConfig(
		model.provider,
	);
	if (registeredProvider || requestAuth.apiKey || requestAuth.headers) {
		const { oauth, ...providerConfig } = registeredProvider ?? {};
		modelRuntime.registerProvider(model.provider, {
			...providerConfig,
			...(storedCredential?.type !== "oauth" && requestAuth.apiKey
				? { apiKey: requestAuth.apiKey }
				: {}),
			headers: {
				...registeredProvider?.headers,
				...requestAuth.headers,
			},
			...(storedCredential?.type === "oauth" && oauth ? { oauth } : {}),
		});
	}

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: SUMMARY_SYSTEM_PROMPT,
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model,
		thinkingLevel: config.summary.thinking,
		modelRuntime,
		noTools: "all",
		resourceLoader,
		sessionManager: SessionManager.inMemory(ctx.cwd),
		settingsManager,
	});
	let abortPromise: Promise<void> | undefined;
	const abortSummary = () => {
		abortPromise ??= session.abort();
	};
	signal?.addEventListener("abort", abortSummary, { once: true });

	try {
		if (signal?.aborted) {
			abortSummary();
			throw new Error("Summary model was aborted");
		}
		await session.prompt(prompt, {
			expandPromptTemplates: false,
			source: "extension",
		});
		const response = lastAssistantMessage(session.messages);
		if (!response)
			throw new Error("Summary model returned no assistant message");
		if (response.stopReason === "error") {
			throw new Error(response.errorMessage || "Summary model failed");
		}
		if (response.stopReason === "aborted") {
			throw new Error("Summary model was aborted");
		}
		return response;
	} finally {
		signal?.removeEventListener("abort", abortSummary);
		await abortPromise;
		session.dispose();
	}
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (
				part &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text"
			) {
				return String((part as { text?: unknown }).text ?? "");
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function serializeEntry(entry: SessionEntry): string | undefined {
	switch (entry.type) {
		case "message": {
			const message = entry.message as { role?: string; content?: unknown };
			const text = textFromContent(message.content).trim();
			if (!text) return undefined;
			return `## ${message.role || "message"} (${entry.timestamp})\n${text}`;
		}
		case "branch_summary":
			return `## branch summary (${entry.timestamp})\n${entry.summary}`;
		case "compaction":
			return `## compaction summary (${entry.timestamp})\n${entry.summary}`;
		case "custom_message": {
			const text = textFromContent(entry.content).trim();
			if (!text) return undefined;
			return `## custom message: ${entry.customType} (${entry.timestamp})\n${text}`;
		}
		case "model_change":
			return `## model change (${entry.timestamp})\n${entry.provider}/${entry.modelId}`;
		case "thinking_level_change":
			return `## thinking level change (${entry.timestamp})\n${entry.thinkingLevel}`;
		default:
			return undefined;
	}
}

function buildSummaryInput(entries: SessionEntry[]): string {
	return entries
		.map(serializeEntry)
		.filter((value): value is string => Boolean(value))
		.join("\n\n---\n\n");
}

function escapeConversationBlock(conversation: string): string {
	return conversation
		.replaceAll("</conversation>", "&lt;/conversation&gt;")
		.replaceAll("<conversation>", "&lt;conversation&gt;");
}

function isNoRelevantContext(summary: string): boolean {
	return (
		summary
			.trim()
			.toLowerCase()
			.replace(/^#+\s*/, "")
			.replace(/[.!]+$/, "") === "no relevant conversation context"
	);
}

function buildPrompt(conversation: string): string {
	return `You are preparing a compact branch-style summary for an isolated code-review subagent.

Summarize the current Pi session branch as durable context for reviewing the current git diff.

Rules:
- Do not quote or reproduce user/assistant turns verbatim.
- Do not include step-by-step debugging noise.
- Do not include long command output.
- Do not invent details.
- Preserve uncertainty where the conversation is ambiguous.

Capture only:
- the user's actual goal
- final or accepted implementation direction
- important constraints and non-goals
- repo areas/files that matter
- tests/checks run and their outcomes
- decisions that may make a suspicious diff intentional
- unresolved risks or TODOs relevant to review

Write concise structured markdown. If the conversation contains no useful review context, output exactly: No relevant conversation context.

<conversation>
${escapeConversationBlock(conversation)}
</conversation>`;
}

export async function buildReviewConversationSummary(
	ctx: ExtensionCommandContext,
	config: ResolvedReviewConfig,
): Promise<string | undefined> {
	if (!config.summary.enabled) return undefined;

	const conversation = buildSummaryInput(
		ctx.sessionManager.buildContextEntries(),
	);
	if (!conversation.trim()) return undefined;

	const response = await completeSummary(
		ctx,
		config,
		buildPrompt(conversation),
	);

	const summary = response.content
		.filter(
			(part): part is { type: "text"; text: string } => part.type === "text",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();

	if (!summary || isNoRelevantContext(summary)) return undefined;
	return summary;
}
