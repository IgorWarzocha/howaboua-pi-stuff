import test from "node:test";
import assert from "node:assert/strict";
import { clampOpenAICodexModelWindows, createOpenAICodexNativeAuthorizationFlow, OPENAI_CODEX_NATIVE_SCOPE } from "../src/providers/openai-codex/oauth.ts";

test("Codex OAuth authorization flow requests native connector scopes", async () => {
	const flow = await createOpenAICodexNativeAuthorizationFlow("pi-test");
	const url = new URL(flow.url);

	assert.equal(url.origin + url.pathname, "https://auth.openai.com/oauth/authorize");
	assert.equal(url.searchParams.get("scope"), OPENAI_CODEX_NATIVE_SCOPE);
	assert.equal(url.searchParams.get("codex_cli_simplified_flow"), "true");
	assert.equal(url.searchParams.get("id_token_add_organizations"), "true");
	assert.equal(url.searchParams.get("originator"), "pi-test");
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	assert.ok(url.searchParams.get("code_challenge"));
	assert.ok(flow.verifier);
	assert.ok(flow.state);
});

test("Codex provider conservatively clamps GPT-5.6 production windows", () => {
	const models = [
		{ id: "gpt-5.6-sol", contextWindow: 372_000 },
		{ id: "gpt-5.6-luna", contextWindow: 250_000 },
		{ id: "gpt-5.5", contextWindow: 372_000 },
	] as never;

	assert.deepEqual(
		clampOpenAICodexModelWindows(models).map(({ id, contextWindow }) => ({ id, contextWindow })),
		[
			{ id: "gpt-5.6-sol", contextWindow: 272_000 },
			{ id: "gpt-5.6-luna", contextWindow: 250_000 },
			{ id: "gpt-5.5", contextWindow: 372_000 },
		],
	);
});
