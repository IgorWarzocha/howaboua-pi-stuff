import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type Credential,
	type CredentialStore,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	type ExtensionCommandContext,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { buildReviewConversationSummary } from "../src/conversation-summary.js";
import type { ResolvedReviewConfig } from "../src/types.js";

const PROVIDER = "summary-sdk-test";
const API = "summary-sdk-test-api" as Api;
let registry: ModelRegistry | undefined;

function credentialStore(
	initial: Record<string, Credential> = {},
): CredentialStore {
	const credentials = new Map(Object.entries(initial));
	return {
		async read(providerId) {
			return credentials.get(providerId);
		},
		async list() {
			return [...credentials].map(([providerId, credential]) => ({
				providerId,
				type: credential.type,
			}));
		},
		async modify(providerId, update) {
			const current = credentials.get(providerId);
			const next = await update(current);
			if (next) credentials.set(providerId, next);
			return next ?? current;
		},
		async delete(providerId) {
			credentials.delete(providerId);
		},
	};
}

afterEach(() => {
	registry?.unregisterProvider(PROVIDER);
	registry = undefined;
});

function responseStream(
	options: SimpleStreamOptions | undefined,
	model: Pick<Model<Api>, "api" | "id" | "provider"> = {
		api: API,
		id: "summary-model",
		provider: PROVIDER,
	},
) {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "Review context summary" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 10,
			output: 3,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 13,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
	queueMicrotask(() => {
		stream.push({ type: "start", partial: { ...message, content: [] } });
		stream.push({ type: "text_start", contentIndex: 0, partial: message });
		stream.push({
			type: "text_delta",
			contentIndex: 0,
			delta: "Review context summary",
			partial: message,
		});
		stream.push({
			type: "text_end",
			contentIndex: 0,
			content: "Review context summary",
			partial: message,
		});
		stream.push({ type: "done", reason: "stop", message });
		stream.end();
	});
	return { stream, options };
}

function abortedResponseStream(
	options: SimpleStreamOptions | undefined,
	onStart: () => void,
) {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
		api: API,
		provider: PROVIDER,
		model: "summary-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "aborted",
		timestamp: Date.now(),
	};
	options?.signal?.addEventListener(
		"abort",
		() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "aborted", message });
			stream.end();
		},
		{ once: true },
	);
	onStart();
	return stream;
}

function summarize(
	modelRegistry: ModelRegistry,
	provider = PROVIDER,
	modelId = "summary-model",
	signal?: AbortSignal,
) {
	const sessionManager = SessionManager.inMemory(process.cwd());
	sessionManager.appendMessage({
		role: "user",
		content: "Please review this change",
		timestamp: Date.now(),
	});
	const ctx = {
		cwd: process.cwd(),
		modelRegistry,
		sessionManager,
		signal,
	} as unknown as ExtensionCommandContext;
	const config: ResolvedReviewConfig = {
		model: `${provider}/${modelId}`,
		thinking: "medium",
		source: "configured",
		summary: {
			enabled: true,
			model: `${provider}/${modelId}`,
			modelParsed: { provider, modelId },
			thinking: "low",
			source: "configured",
		},
	};
	return buildReviewConversationSummary(ctx, config);
}

async function summarizeWithAuth(
	credentials: CredentialStore,
	authConfig: Pick<
		Parameters<ModelRegistry["registerProvider"]>[1],
		"apiKey" | "authHeader" | "oauth"
	>,
) {
	const runtime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		allowModelNetwork: false,
	});
	registry = new ModelRegistry(runtime);
	let receivedOptions: SimpleStreamOptions | undefined;
	let receivedModel: Model<Api> | undefined;
	registry.registerProvider(PROVIDER, {
		baseUrl: "https://summary.invalid/v1",
		api: API,
		...authConfig,
		streamSimple(model, _context, options) {
			receivedModel = model;
			receivedOptions = options;
			return responseStream(options, model).stream;
		},
		models: [
			{
				id: "summary-model",
				name: "Summary Model",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4_096,
			},
		],
	});
	await runtime.refresh({ allowNetwork: false });

	const summary = await summarize(registry);
	return { summary, receivedModel, receivedOptions };
}

test("uses the public Pi session path for extension-registered providers", async () => {
	const result = await summarizeWithAuth(
		credentialStore({
			[PROVIDER]: {
				type: "api_key",
				key: "stored-key",
				env: { SUMMARY_ACCOUNT: "account-123" },
			},
		}),
		{ apiKey: "configured-key", authHeader: true },
	);

	expect(result.summary).toBe("Review context summary");
	expect(result.receivedOptions?.apiKey).toBe("stored-key");
	expect(result.receivedOptions?.headers?.Authorization).toBe(
		"Bearer stored-key",
	);
	expect(result.receivedOptions?.env?.SUMMARY_ACCOUNT).toBe("account-123");
});

test("resolves environment-backed provider auth", async () => {
	process.env["SUMMARY_SDK_TEST_KEY"] = "environment-key";
	try {
		const result = await summarizeWithAuth(credentialStore(), {
			apiKey: "$SUMMARY_SDK_TEST_KEY",
		});
		expect(result.summary).toBe("Review context summary");
		expect(result.receivedOptions?.apiKey).toBe("environment-key");
	} finally {
		delete process.env["SUMMARY_SDK_TEST_KEY"];
	}
});

test("resolves OAuth provider auth", async () => {
	const credentials = {
		type: "oauth" as const,
		refresh: "refresh-token",
		access: "oauth-access-token",
		expires: Date.now() + 60_000,
	};
	const result = await summarizeWithAuth(
		credentialStore({ [PROVIDER]: credentials }),
		{
			oauth: {
				name: "Summary OAuth",
				async login() {
					return credentials;
				},
				async refreshToken(current) {
					return current;
				},
				getApiKey(current) {
					return current.access;
				},
				modifyModels(models) {
					return models.map((model) => ({
						...model,
						baseUrl: "https://projected.invalid/v1",
					}));
				},
			},
		},
	);

	expect(result.summary).toBe("Review context summary");
	expect(result.receivedOptions?.apiKey).toBe("oauth-access-token");
	expect(result.receivedModel?.baseUrl).toBe("https://projected.invalid/v1");
});

test("preserves credential-derived OAuth endpoints", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-review-auth-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const provider = "github-copilot";
	const modelId = "claude-fable-5";
	const credentials: Credential = {
		type: "oauth",
		refresh: "github-token",
		access: "tid=test;exp=9999999999;proxy-ep=proxy.enterprise.example;",
		expires: Date.now() + 60 * 60 * 1000,
		availableModelIds: [modelId],
	};
	await writeFile(
		join(agentDir, "auth.json"),
		JSON.stringify({ [provider]: credentials }),
	);
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {
		const runtime = await ModelRuntime.create({
			credentials: credentialStore({ [provider]: credentials }),
			modelsPath: null,
			allowModelNetwork: false,
		});
		registry = new ModelRegistry(runtime);
		let receivedModel: Model<Api> | undefined;
		registry.registerProvider(provider, {
			api: "openai-completions",
			streamSimple(model, _context, options) {
				receivedModel = model;
				return responseStream(options, model).stream;
			},
		});
		await runtime.refresh({ allowNetwork: false });

		expect(await summarize(registry, provider, modelId)).toBe(
			"Review context summary",
		);
		expect(receivedModel?.baseUrl).toBe("https://api.enterprise.example");
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("aborts an in-flight summary when the review is cancelled", async () => {
	const controller = new AbortController();
	let markStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	registry = new ModelRegistry(
		await ModelRuntime.create({
			credentials: credentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		}),
	);
	registry.registerProvider(PROVIDER, {
		baseUrl: "https://summary.invalid/v1",
		api: API,
		apiKey: "configured-key",
		streamSimple(_model, _context, options) {
			return abortedResponseStream(options, markStarted);
		},
		models: [
			{
				id: "summary-model",
				name: "Summary Model",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4_096,
			},
		],
	});

	const summary = summarize(
		registry,
		PROVIDER,
		"summary-model",
		controller.signal,
	);
	await started;
	controller.abort();

	await expect(summary).rejects.toThrow("Summary model was aborted");
});
