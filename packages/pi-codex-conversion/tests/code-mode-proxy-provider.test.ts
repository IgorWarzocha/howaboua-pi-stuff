import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { CodexConversionConfig } from "../src/adapter/activation/config.ts";
import { registerCodeModeProxyProvider, streamCodeModeResponsesProxy } from "../src/providers/code-mode-proxy-provider.ts";

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

function fallbackResponsesStream(
	_model?: unknown,
	context?: { systemPrompt?: string },
) {
	return (async function* () {
		const content = context?.systemPrompt === "Context windows"
			? [{
				type: "toolCall",
				id: "call_note|fc_note",
				name: "write_file",
				namespace: "notes",
				arguments: { path: "checkpoint.md", text: "done" },
			}]
			: [{ type: "text", text: "fallback", textSignature: '{"v":1,"id":"msg_1"}' }];
		yield { type: "done", message: { content } };
	})();
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

test("the Code Mode proxy rejects unfinished terminal response statuses", async () => {
	const originalFetch = globalThis.fetch;
	try {
		for (const status of [undefined, "queued", "in_progress"] as const) {
			globalThis.fetch = (async () => sseResponse([{
				type: "response.completed",
				response: {
					id: `resp_${status ?? "missing"}`,
					...(status ? { status } : {}),
					usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
				},
			}])) as typeof fetch;

			const events = await collect(streamCodeModeResponsesProxy(
				proxyModel as never,
				{ systemPrompt: "Use Code Mode", messages: [], tools: [] } as never,
				{ apiKey: "test-key" },
			));
			const terminal = events.at(-1) as { type: string; error: { stopReason: string } };
			assert.equal(terminal.type, "error", status ?? "missing status");
			assert.equal(terminal.error.stopReason, "error");
			assert.equal(events.some((event) => (event as { type?: string }).type === "done"), false);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the provider-scoped proxy stream delegates ordinary Responses models without recursion", async () => {
	const providers = new Map<string, {
		api?: string;
		streamSimple: (...args: never[]) => AsyncIterable<unknown>;
	}>();
	const unregistered: string[] = [];
	const config: CodexConversionConfig = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		executionMode: "code" as const,
		openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, proxyResponsesLite: true },
		compaction: { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction },
		scope: { allProviders: "off" as const, additionalProviders: ["proxy"] },
	};
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
		getProvider: () => ({ streamSimple: fallbackResponsesStream }) as never,
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

	config.compaction.contextManagement = "local";
	registration.applyConfig(config, {
		getAll: () => [
			{ provider: "proxy", api: "openai-responses" },
			{ provider: "renamed", api: "openai-codex-responses", id: "gpt-5.6" },
		] as never,
		getProvider: () => ({ streamSimple: fallbackResponsesStream }) as never,
		getRegisteredProviderConfig: (name: string) => providers.get(name) as never,
	});
	const contextEvents = await collect(provider.streamSimple(
		{ ...proxyModel, id: "gpt-5.5" } as never,
		{
			systemPrompt: "Context windows",
			messages: [],
			tools: [{ name: "history" }, { name: "notes" }],
		} as never,
		{ apiKey: "test-key" } as never,
	));
	assert.deepEqual(
		(contextEvents.at(-1) as { message: { content: unknown[] } }).message.content,
		[{
			type: "toolCall",
			id: "call_note|fc_note",
			name: "notes",
			namespace: "notes",
			arguments: {
				action: "write_file",
				path: "checkpoint.md",
				text: "done",
			},
		}],
	);
	assert.equal(providers.get("renamed")?.api, "openai-codex-responses");

	config.voiceFeaturesOnly = true;
	registration.applyConfig(config, {
		getAll: () => [{ provider: "proxy", api: "openai-responses" }] as never,
		getProvider: () => ({ streamSimple: fallbackResponsesStream }) as never,
		getRegisteredProviderConfig: (name: string) => providers.get(name) as never,
	});
	assert.equal(providers.size, 0);

	registration.shutdown();
	registration.shutdown();
	assert.equal(providers.size, 0);
	assert.equal(unregistered.length, 2);
});
