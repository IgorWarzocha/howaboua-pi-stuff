import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { applyCodeModeFreeformContract } from "../src/adapter/code-mode-contract.ts";
import {
	registerCodeModeProxyProvider,
	streamCodeModeResponsesProxy,
} from "../src/providers/code-mode-proxy-provider.ts";
import { applyResponsesLiteRequest } from "../src/providers/openai-codex/responses-lite.ts";

function sseResponse(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const events: unknown[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

const proxyModel = {
	provider: "proxy",
	api: "openai-responses",
	id: "gpt-5.6",
	baseUrl: "https://proxy.example/v1",
	input: ["text", "image"],
	reasoning: true,
	contextWindow: 100_000,
	maxTokens: 10_000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

test("configured Responses providers stream raw Code Mode exec calls", async () => {
	const originalFetch = globalThis.fetch;
	let requestBody: Record<string, unknown> | undefined;
	let requestHeaders: Headers | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			requestBody = JSON.parse(String(init?.body));
			requestHeaders = new Headers(init?.headers);
			return sseResponse([
				{ type: "response.created", response: { id: "resp_proxy" } },
				{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "" } },
				{ type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "text(\"ok\");" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "text(\"ok\");", status: "completed" } },
				{ type: "response.completed", response: { id: "resp_proxy", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
			]);
		}) as typeof fetch;

		const events = await collect(streamCodeModeResponsesProxy(
			proxyModel as never,
			{
				systemPrompt: "Use Code Mode",
				messages: [{ role: "user", content: [{ type: "image", data: "not-valid", mimeType: "image/png" }], timestamp: Date.now() }],
				tools: [{ name: "exec", description: "Run JavaScript", parameters: { type: "object" } }],
			} as never,
			{
				headers: {
					Authorization: "Bearer proxy-key",
					"X-OpenAI-Internal-Codex-Responses-Lite": "false",
					"x-stainless-lang": null,
				},
				onPayload: (payload: unknown) => applyResponsesLiteRequest(applyCodeModeFreeformContract(payload as never)),
			} as never,
		));

		const input = requestBody?.["input"] as Array<Record<string, unknown>>;
		assert.equal(input[0]?.["type"], "additional_tools");
		assert.equal((input[0]?.["tools"] as Array<{ type: string }>)[0]?.type, "custom");
		assert.deepEqual((input[2]?.["content"] as unknown[])[0], {
			type: "input_text",
			text: "image content omitted because it could not be processed",
		});
		assert.equal(requestHeaders?.get("x-openai-internal-codex-responses-lite"), "true");
		assert.equal(requestHeaders?.get("authorization"), "Bearer proxy-key");
		assert.equal(requestHeaders?.has("x-stainless-lang"), false);
		const toolCallEnd = events.find((event) => (event as { type?: string }).type === "toolcall_end") as {
			toolCall: { name: string; arguments: { code: string } };
		};
		assert.deepEqual(toolCallEnd.toolCall, {
			type: "toolCall",
			id: "call_1|ctc_1",
			name: "exec",
			arguments: { code: "text(\"ok\");" },
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the proxy stream marks only actual Responses Lite bodies", async () => {
	const originalFetch = globalThis.fetch;
	let requestHeaders: Headers | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			requestHeaders = new Headers(init?.headers);
			return sseResponse([
				{ type: "response.created", response: { id: "resp_standard" } },
				{ type: "response.completed", response: { id: "resp_standard", status: "completed", usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } },
			]);
		}) as typeof fetch;

		await collect(streamCodeModeResponsesProxy(
			proxyModel as never,
			{ systemPrompt: "Use Code Mode", messages: [], tools: [] } as never,
			{
				headers: {
					Authorization: "Bearer proxy-key",
					"X-OpenAI-Internal-Codex-Responses-Lite": "true",
				},
				onPayload: (payload: unknown) => applyCodeModeFreeformContract(payload as never),
			} as never,
		));

		assert.equal(requestHeaders?.has("x-openai-internal-codex-responses-lite"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the proxy stream preserves Cloudflare header-only authentication", async () => {
	const originalFetch = globalThis.fetch;
	let requestHeaders: Headers | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			requestHeaders = new Headers(init?.headers);
			return sseResponse([
				{ type: "response.created", response: { id: "resp_cf" } },
				{ type: "response.completed", response: { id: "resp_cf", status: "completed", usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } },
			]);
		}) as typeof fetch;

		await collect(streamCodeModeResponsesProxy(
			proxyModel as never,
			{ systemPrompt: "Use Code Mode", messages: [], tools: [] } as never,
			{ headers: { "cf-aig-authorization": "Bearer cf-token" } } as never,
		));

		assert.equal(requestHeaders?.get("cf-aig-authorization"), "Bearer cf-token");
		assert.equal(requestHeaders?.has("authorization"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the proxy stream reports failed HTTP responses", async () => {
	const originalFetch = globalThis.fetch;
	const responses: Array<{ status: number; headers: Record<string, string> }> = [];
	try {
		globalThis.fetch = (async () => new Response(
			JSON.stringify({ error: { message: "proxy rejected request" } }),
			{ status: 401, headers: { "content-type": "application/json", "x-request-id": "req_proxy" } },
		)) as typeof fetch;

		const events = await collect(streamCodeModeResponsesProxy(
			proxyModel as never,
			{ systemPrompt: "Use Code Mode", messages: [], tools: [] } as never,
			{
				apiKey: "test-key",
				onResponse: (response: { status: number; headers: Record<string, string> }) => responses.push(response),
			} as never,
		));

		assert.equal(responses.length, 1);
		assert.equal(responses[0]?.status, 401);
		assert.equal(responses[0]?.headers["x-request-id"], "req_proxy");
		const error = events.at(-1) as { type: string; error: { errorMessage?: string } };
		assert.equal(error.type, "error");
		assert.match(error.error.errorMessage ?? "", /401.*proxy rejected request/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the provider-scoped proxy stream delegates ordinary Responses models without recursion", async () => {
	const originalFetch = globalThis.fetch;
	const providers = new Map<string, { streamSimple: (...args: never[]) => AsyncIterable<unknown> }>();
	const unregistered: string[] = [];
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { codeMode: true, responsesLite: false },
		scope: { allProviders: "off" as const, additionalProviders: ["proxy"] },
	};
	try {
		globalThis.fetch = (async () => sseResponse([
			{ type: "response.created", response: { id: "resp_fallback" } },
			{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [] } },
			{ type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "" } },
			{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "fallback" },
			{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "fallback", annotations: [] }], status: "completed" } },
			{ type: "response.completed", response: { id: "resp_fallback", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
		])) as typeof fetch;

		const registration = registerCodeModeProxyProvider({
			registerProvider(name: string, provider: { streamSimple: (...args: never[]) => AsyncIterable<unknown> }) {
				providers.set(name, provider);
			},
			unregisterProvider(name: string) {
				unregistered.push(name);
				providers.delete(name);
			},
		} as never, () => config);

		assert.equal(providers.size, 0);
		registration.applyConfig(config, {
			getAll: () => [{ provider: "proxy", api: "openai-responses" }] as never,
			getRegisteredProviderConfig: (name: string) => providers.get(name) as never,
		});
		assert.equal(providers.size, 1);
		assert.ok(providers.has("proxy"));
		const provider = [...providers.values()][0]!;
		const events = await collect(provider.streamSimple(
			{ ...proxyModel, id: "gpt-5.5" } as never,
			{ systemPrompt: "Be useful", messages: [{ role: "user", content: "Hello", timestamp: Date.now() }] } as never,
			{ apiKey: "test-key" } as never,
		));
		const done = events.at(-1) as { type: string; message: { content: Array<{ type: string; text?: string }> } };
		assert.equal(done.type, "done");
		assert.deepEqual(done.message.content, [{ type: "text", text: "fallback", textSignature: "{\"v\":1,\"id\":\"msg_1\"}" }]);

		registration.shutdown();
		registration.shutdown();
		assert.equal(providers.size, 0);
		assert.equal(unregistered.length, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the provider-scoped proxy stream preserves an existing extension provider", async () => {
	const originalStream = (() => "original") as never;
	const originalProvider = {
		api: "openai-responses" as const,
		baseUrl: "https://extension.example/v1",
		apiKey: "extension-key",
		streamSimple: originalStream,
		models: [{
			id: "gpt-5.5",
			name: "Extension model",
			reasoning: true,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 10_000,
		}],
	};
	let provider: Parameters<ModelRegistry["registerProvider"]>[1] | undefined = originalProvider;
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { codeMode: true, responsesLite: false },
		scope: { allProviders: "off" as const, additionalProviders: ["extensionproxy"] },
	};
	const registration = registerCodeModeProxyProvider({
		registerProvider(_name: string, overlay: Parameters<ModelRegistry["registerProvider"]>[1]) {
			provider = { ...provider, ...overlay };
		},
		unregisterProvider() {
			provider = undefined;
		},
	} as never, () => config);
	const modelRegistry = {
		getAll: () => [{ provider: "ExtensionProxy", api: "openai-responses" }] as never,
		getRegisteredProviderConfig: () => provider,
	};

	registration.applyConfig(config, modelRegistry);
	assert.notEqual(provider?.streamSimple, originalStream);
	assert.equal(provider?.streamSimple?.({ ...proxyModel, provider: "ExtensionProxy", id: "gpt-5.5" } as never, {} as never), "original");
	registration.applyConfig({ ...config, beta: { ...config.beta, codeMode: false } }, modelRegistry);
	assert.deepEqual(provider, originalProvider);

	registration.applyConfig(config, modelRegistry);
	assert.notEqual(provider?.streamSimple, originalStream);

	registration.shutdown();
	assert.deepEqual(provider, originalProvider);
});

test("provider overlays ignore configured providers without Responses models", () => {
	const providers = new Map<string, unknown>();
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { codeMode: true, responsesLite: false },
		scope: { allProviders: "off" as const, additionalProviders: ["anthropic-proxy"] },
	};
	const registration = registerCodeModeProxyProvider({
		registerProvider(name: string, provider: unknown) {
			providers.set(name, provider);
		},
		unregisterProvider(name: string) {
			providers.delete(name);
		},
	} as never, () => config);

	registration.applyConfig(config, {
		getAll: () => [{ provider: "anthropic-proxy", api: "anthropic-messages" }] as never,
		getRegisteredProviderConfig: () => undefined,
	});
	assert.equal(providers.size, 0);
});

test("mixed-API providers preserve an existing non-Responses custom stream", () => {
	const originalStream = (() => "anthropic") as never;
	const originalProvider = {
		api: "anthropic-messages" as const,
		streamSimple: originalStream,
	};
	const provider = originalProvider;
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { codeMode: true, responsesLite: false },
		scope: { allProviders: "off" as const, additionalProviders: ["mixed-proxy"] },
	};
	const registration = registerCodeModeProxyProvider({
		registerProvider() {
			throw new Error("must not replace the provider's non-Responses stream");
		},
		unregisterProvider() {
			throw new Error("must not unregister the provider's non-Responses stream");
		},
	} as never, () => config);

	registration.applyConfig(config, {
		getAll: () => [
			{ provider: "mixed-proxy", api: "anthropic-messages" },
			{ provider: "mixed-proxy", api: "openai-responses" },
		] as never,
		getRegisteredProviderConfig: () => provider,
	});

	assert.equal(provider.streamSimple, originalStream);
});

test("provider teardown preserves later registrations and never restores stale streams", () => {
	const originalStream = (() => "original") as never;
	const replacementStream = (() => "replacement") as never;
	let provider: Parameters<ModelRegistry["registerProvider"]>[1] | undefined = {
		api: "openai-responses",
		streamSimple: originalStream,
	};
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { codeMode: true, responsesLite: false },
		scope: { allProviders: "off" as const, additionalProviders: ["proxy"] },
	};
	const registration = registerCodeModeProxyProvider({
		registerProvider(_name: string, overlay: Parameters<ModelRegistry["registerProvider"]>[1]) {
			provider = { ...provider, ...overlay };
		},
		unregisterProvider() {
			provider = undefined;
		},
	} as never, () => config);
	const modelRegistry = {
		getAll: () => [{ provider: "proxy", api: "openai-responses" }] as never,
		getRegisteredProviderConfig: () => provider,
	};

	registration.applyConfig(config, modelRegistry);
	provider = { ...provider, headers: { "x-later-extension": "true" } };
	registration.applyConfig({ ...config, beta: { ...config.beta, codeMode: false } }, modelRegistry);
	assert.equal(provider?.streamSimple, originalStream);
	assert.deepEqual(provider?.headers, { "x-later-extension": "true" });

	registration.applyConfig(config, modelRegistry);
	provider = { ...provider, streamSimple: replacementStream };
	registration.shutdown();
	assert.equal(provider?.streamSimple, replacementStream);
});

test("Pi 0.80.7 keeps using the API-level compatibility bridge", () => {
	const providers = new Map<string, unknown>();
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { codeMode: true, responsesLite: false },
		scope: { allProviders: "off" as const, additionalProviders: ["proxy"] },
	};
	const registration = registerCodeModeProxyProvider({
		registerProvider(name: string, provider: unknown) {
			providers.set(name, provider);
		},
		unregisterProvider(name: string) {
			providers.delete(name);
		},
	} as never, () => config);

	registration.applyConfig(config, { getAll: () => [{ provider: "proxy" }] as never });
	assert.equal(providers.size, 1);
	assert.equal(providers.has("proxy"), false);

	registration.shutdown();
	assert.equal(providers.size, 0);
});

test("configured Responses models route through the Code Mode stream in Pi's model runtime", async () => {
	const originalFetch = globalThis.fetch;
	const agentDir = await mkdtemp(join(tmpdir(), "pi-code-mode-proxy-"));
	let registration: ReturnType<typeof registerCodeModeProxyProvider> | undefined;
	try {
		await writeFile(join(agentDir, "models.json"), JSON.stringify({
			providers: {
				MyProxy: {
					baseUrl: "https://proxy.example/v1",
					apiKey: "test-key",
					api: "openai-responses",
					models: [{
						id: "gpt-5.6",
						name: "GPT-5.6 Proxy",
						reasoning: true,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100_000,
						maxTokens: 10_000,
					}],
				},
			},
		}));
		globalThis.fetch = (async () => sseResponse([
			{ type: "response.created", response: { id: "resp_runtime" } },
			{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "" } },
			{ type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "text(\"runtime\");" },
			{ type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "text(\"runtime\");", status: "completed" } },
			{ type: "response.completed", response: { id: "resp_runtime", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
		])) as typeof fetch;

		const runtime = await ModelRuntime.create({
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const registry = new ModelRegistry(runtime);
		const config = {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { codeMode: true, responsesLite: false },
			scope: { allProviders: "off" as const, additionalProviders: ["myproxy"] },
		};
		registration = registerCodeModeProxyProvider({
			registerProvider: (name: string, provider: Parameters<ModelRegistry["registerProvider"]>[1]) =>
				registry.registerProvider(name, provider),
			unregisterProvider: (name: string) => registry.unregisterProvider(name),
		} as never, () => config);
		registration.applyConfig(config, registry);
		await runtime.refresh({ allowNetwork: false });

		const model = registry.find("MyProxy", "gpt-5.6");
		assert.ok(model);
		const events = await collect(runtime.streamSimple(
			model,
			{ systemPrompt: "Use Code Mode", messages: [], tools: [{ name: "exec", description: "Run JavaScript", parameters: { type: "object" } }] } as never,
			{ onPayload: (payload: unknown) => applyCodeModeFreeformContract(payload as never) } as never,
		));
		const done = events.at(-1) as { type: string; reason: string; message: { content: unknown[] } };
		assert.equal(done.type, "done");
		assert.equal(done.reason, "toolUse");
		assert.deepEqual(done.message.content, [{
			type: "toolCall",
			id: "call_1|ctc_1",
			name: "exec",
			arguments: { code: "text(\"runtime\");" },
		}]);
	} finally {
		registration?.shutdown();
		globalThis.fetch = originalFetch;
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("the proxy stream rejects an incomplete Responses stream", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = (async () => sseResponse([
			{ type: "response.created", response: { id: "resp_incomplete" } },
		])) as typeof fetch;
		const events = await collect(streamCodeModeResponsesProxy(
			proxyModel as never,
			{ systemPrompt: "Use Code Mode", messages: [] } as never,
			{ apiKey: "test-key" } as never,
		));
		const error = events.at(-1) as { type: string; error: { errorMessage?: string } };
		assert.equal(error.type, "error");
		assert.match(error.error.errorMessage ?? "", /Stream closed before response\.completed/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
