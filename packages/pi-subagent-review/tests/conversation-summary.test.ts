import { afterEach, expect, test } from "bun:test";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	AuthStorage,
	type ExtensionCommandContext,
	ModelRegistry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { buildReviewConversationSummary } from "../src/conversation-summary.js";
import type { ResolvedReviewConfig } from "../src/types.js";

const PROVIDER = "summary-sdk-test";
const API = "summary-sdk-test-api" as Api;
let registry: ModelRegistry | undefined;

afterEach(() => {
	registry?.unregisterProvider(PROVIDER);
	registry = undefined;
});

function responseStream(options: SimpleStreamOptions | undefined) {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "Review context summary" }],
		api: API,
		provider: PROVIDER,
		model: "summary-model",
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

async function summarizeWithAuth(
	authStorage: AuthStorage,
	authConfig: Pick<
		Parameters<ModelRegistry["registerProvider"]>[1],
		"apiKey" | "authHeader" | "oauth"
	>,
) {
	registry = ModelRegistry.inMemory(authStorage);
	let receivedOptions: SimpleStreamOptions | undefined;
	registry.registerProvider(PROVIDER, {
		baseUrl: "https://summary.invalid/v1",
		api: API,
		...authConfig,
		streamSimple(_model, _context, options) {
			receivedOptions = options;
			return responseStream(options).stream;
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

	const sessionManager = SessionManager.inMemory(process.cwd());
	sessionManager.appendMessage({
		role: "user",
		content: "Please review this change",
		timestamp: Date.now(),
	});
	const ctx = {
		cwd: process.cwd(),
		modelRegistry: registry,
		sessionManager,
	} as unknown as ExtensionCommandContext;
	const config: ResolvedReviewConfig = {
		model: `${PROVIDER}/summary-model`,
		thinking: "medium",
		source: "configured",
		summary: {
			enabled: true,
			model: `${PROVIDER}/summary-model`,
			modelParsed: { provider: PROVIDER, modelId: "summary-model" },
			thinking: "low",
			source: "configured",
		},
	};

	const summary = await buildReviewConversationSummary(ctx, config);
	return { summary, receivedOptions };
}

test("uses the public Pi session path for extension-registered providers", async () => {
	const result = await summarizeWithAuth(
		AuthStorage.inMemory({
			[PROVIDER]: { type: "api_key", key: "stored-key" },
		}),
		{ apiKey: "configured-key", authHeader: true },
	);

	expect(result.summary).toBe("Review context summary");
	expect(result.receivedOptions?.apiKey).toBe("stored-key");
	expect(result.receivedOptions?.headers?.Authorization).toBe(
		"Bearer stored-key",
	);
});

test("resolves environment-backed provider auth", async () => {
	process.env["SUMMARY_SDK_TEST_KEY"] = "environment-key";
	try {
		const result = await summarizeWithAuth(AuthStorage.inMemory(), {
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
		AuthStorage.inMemory({ [PROVIDER]: credentials }),
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
			},
		},
	);

	expect(result.summary).toBe("Review context summary");
	expect(result.receivedOptions?.apiKey).toBe("oauth-access-token");
});

test("aborts an in-flight summary when the review is cancelled", async () => {
	const controller = new AbortController();
	let markStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	registry = ModelRegistry.inMemory(AuthStorage.inMemory());
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

	const sessionManager = SessionManager.inMemory(process.cwd());
	sessionManager.appendMessage({
		role: "user",
		content: "Please review this change",
		timestamp: Date.now(),
	});
	const ctx = {
		cwd: process.cwd(),
		modelRegistry: registry,
		sessionManager,
		signal: controller.signal,
	} as unknown as ExtensionCommandContext;
	const config: ResolvedReviewConfig = {
		model: `${PROVIDER}/summary-model`,
		thinking: "medium",
		source: "configured",
		summary: {
			enabled: true,
			model: `${PROVIDER}/summary-model`,
			modelParsed: { provider: PROVIDER, modelId: "summary-model" },
			thinking: "low",
			source: "configured",
		},
	};

	const summary = buildReviewConversationSummary(ctx, config);
	await started;
	controller.abort();

	await expect(summary).rejects.toThrow("Summary model was aborted");
});
