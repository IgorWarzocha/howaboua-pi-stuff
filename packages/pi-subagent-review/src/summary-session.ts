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

export async function completeSummary(
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
