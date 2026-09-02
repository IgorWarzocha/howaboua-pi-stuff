import assert from "node:assert/strict";
import test from "node:test";
import { ChatGptCloudflareCookieStore } from "../src/codex-runtime/cloudflare-cookies.js";
import {
	fetchCodexTool,
	isConfiguredCodexToolProvider,
} from "../src/codex-runtime/index.js";
import { resolveCodexSearchUrl } from "../src/codex-runtime/urls.js";

test("Codex requests keep provider policy and bounded HTTP state", async () => {
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
	const unregister = pi.events.on(
		"@howaboua/pi-codex-conversion.configured-provider/v1",
		(value) => {
			if (
				!value ||
				typeof value !== "object" ||
				!("model" in value) ||
				!("allow" in value) ||
				typeof value.allow !== "function"
			)
				return;
			const model = value.model as { provider?: string } | undefined;
			if (model?.provider === "configured") value.allow();
		},
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
