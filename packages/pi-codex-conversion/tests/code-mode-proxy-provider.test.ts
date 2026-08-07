import test from "node:test";
import assert from "node:assert/strict";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { CODE_MODE_EXEC_GRAMMAR } from "../src/tools/code-mode/exec-contract.ts";
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

function fallbackResponsesStream() {
	return (async function* () {
		yield { type: "done", message: { content: [{ type: "text", text: "fallback", textSignature: '{"v":1,"id":"msg_1"}' }] } };
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
	const providers = new Map<string, { streamSimple: (...args: never[]) => AsyncIterable<unknown> }>();
	const unregistered: string[] = [];
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		beta: { codeMode: true, responsesLite: true },
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
	assert.equal(unregistered.length, 1);
});

test("configured Responses models route through the Code Mode stream in Pi's model runtime", async () => {
	const originalFetch = globalThis.fetch;
	let capturedRequest: RequestInit | undefined;
	let registration: ReturnType<typeof registerCodeModeProxyProvider> | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			capturedRequest = init;
			return sseResponse([
				{ type: "response.created", response: { id: "resp_runtime" } },
				{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "" } },
				{ type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "text(\"runtime\");" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "text(\"runtime\");", status: "completed" } },
				{ type: "response.completed", response: { id: "resp_runtime", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
			]);
		}) as typeof fetch;

		const runtime = await ModelRuntime.create({
			modelsPath: null,
			allowModelNetwork: false,
		});
		const registry = new ModelRegistry(runtime);
		registry.registerProvider("MyProxy", {
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
		});
		const config = {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { codeMode: true, responsesLite: true },
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
			{
				systemPrompt: "Use Code Mode",
				messages: [],
				tools: [{
					name: "exec",
					description: "Run JavaScript",
					parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
					constrainedSampling: { type: "grammar", variants: { openai_lark: CODE_MODE_EXEC_GRAMMAR } },
				}],
			} as never,
			undefined,
		));
		const done = events.at(-1) as { type: string; reason: string; message: { content: unknown[] } };
		assert.ok(capturedRequest);
		assert.equal(new Headers(capturedRequest.headers).get("x-openai-internal-codex-responses-lite"), "true");
		const requestBody = JSON.parse(String(capturedRequest.body));
		assert.equal("tools" in requestBody, false);
		assert.equal(requestBody.parallel_tool_calls, false);
		assert.equal(requestBody.input[0].type, "additional_tools");
		assert.equal(requestBody.input[0].tools[0].type, "custom");
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
	}
});
