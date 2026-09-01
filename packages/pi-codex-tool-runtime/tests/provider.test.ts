import assert from "node:assert/strict";
import test from "node:test";
import {
	fetchCodexTool,
	isConfiguredCodexToolProvider,
	registerCodexToolProviderPolicy,
	resolveCodexSearchUrl,
} from "../index.js";
import { ChatGptCloudflareCookieStore } from "../src/cloudflare-cookies.js";

test("tool runtime composes provider policy with bounded, restricted HTTP state", async () => {
	const handlers: Array<(value: unknown) => void> = [];
	const pi = {
		events: {
			on(_channel: string, handler: (value: unknown) => void) {
				handlers.push(handler);
				return () => handlers.splice(handlers.indexOf(handler), 1);
			},
			emit(_channel: string, value: unknown) {
				for (const handler of handlers) handler(value);
			},
		},
	};
	const unregister = registerCodexToolProviderPolicy(
		pi as never,
		(model) => model?.provider === "configured",
	);
	assert.equal(
		isConfiguredCodexToolProvider(
			pi as never,
			{ provider: "configured" } as never,
		),
		true,
	);
	unregister();
	assert.equal(
		isConfiguredCodexToolProvider(
			pi as never,
			{ provider: "configured" } as never,
		),
		false,
	);
	assert.equal(
		resolveCodexSearchUrl("https://chatgpt.com/backend-api/codex/responses"),
		"https://chatgpt.com/backend-api/codex/alpha/search",
	);
	const cookies = new ChatGptCloudflareCookieStore();
	cookies.storeResponse(new URL("https://chatgpt.com/backend-api/codex"), [
		"cf_clearance=allowed; Domain=.chatgpt.com; Path=/; Secure",
		"session=ignored; Domain=.chatgpt.com; Path=/; Secure",
	]);
	assert.equal(
		cookies.requestHeader(new URL("https://chatgpt.com/backend-api/codex")),
		"cf_clearance=allowed",
	);
	assert.equal(
		cookies.requestHeader(new URL("https://example.com/")),
		undefined,
	);
	await assert.rejects(
		fetchCodexTool("data:text/plain,abcdef", { maxResponseBytes: 4 }),
		/exceeded 4 bytes/,
	);
});
