import test from "node:test";
import assert from "node:assert/strict";
import {
	buildCodexRateLimitResetConsumeUrl,
	buildCodexRateLimitResetCreditsUrl,
	buildCodexUsageUrl,
	consumeCodexRateLimitResetCredit,
	fetchCodexUsage,
	parseCodexRateLimitResetCreditsPayload,
	parseCodexUsagePayload,
} from "../src/ui/settings/usage.ts";

function fakeJwt(accountId: string): string {
	return ["header", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url"), "signature"].join(".");
}

function createCtx(accountId = "acct_usage") {
	return {
		model: { provider: "openai-codex", headers: {} },
		modelRegistry: {
			async getApiKeyAndHeaders() {
				return { ok: true, apiKey: fakeJwt(accountId), headers: {} };
			},
		},
	} as never;
}

test("parseCodexUsagePayload reads reset-credit summary from usage payload", () => {
	const snapshot = parseCodexUsagePayload({
		plan_type: "pro",
		rate_limit_reset_credits: { available_count: 2 },
		rate_limit: {
			primary_window: { used_percent: 100, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
		},
	});

	assert.equal(snapshot.resetCredits?.availableCount, 2);
});

test("parseCodexRateLimitResetCreditsPayload handles standalone credits payload defensively", () => {
	const credits = parseCodexRateLimitResetCreditsPayload({
		available_count: "1",
		credits: [
			{
				id: "RateLimitResetCredit_1",
				reset_type: "codex_rate_limits",
				status: "available",
				granted_at: "2026-06-12T01:31:33.351888Z",
				expires_at: "2026-07-12T01:31:33.351888Z",
				redeem_started_at: null,
				redeemed_at: null,
				title: "One free rate limit reset",
				description: "Thanks for using Codex!",
			},
			"ignored",
		],
	});

	assert.deepEqual(credits, {
		availableCount: 1,
		credits: [{ id: "RateLimitResetCredit_1", resetType: "codex_rate_limits", status: "available", grantedAt: "2026-06-12T01:31:33.351888Z", expiresAt: "2026-07-12T01:31:33.351888Z", redeemStartedAt: undefined, redeemedAt: undefined, title: "One free rate limit reset", description: "Thanks for using Codex!" }],
		raw: {
			available_count: "1",
			credits: [
				{
					id: "RateLimitResetCredit_1",
					reset_type: "codex_rate_limits",
					status: "available",
					granted_at: "2026-06-12T01:31:33.351888Z",
					expires_at: "2026-07-12T01:31:33.351888Z",
					redeem_started_at: null,
					redeemed_at: null,
					title: "One free rate limit reset",
					description: "Thanks for using Codex!",
				},
				"ignored",
			],
		},
	});
});

test("fetchCodexUsage falls back to reset-credit endpoint when usage omits count", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	try {
		globalThis.fetch = (async (url, init) => {
			calls.push({ url: String(url), init: init as RequestInit });
			if (String(url) === buildCodexUsageUrl()) {
				return new Response(JSON.stringify({ plan_type: "plus", rate_limit: null }), { status: 200 });
			}
			return new Response(JSON.stringify({ available_count: 3, credits: [] }), { status: 200 });
		}) as typeof fetch;

		const snapshot = await fetchCodexUsage(createCtx("acct_fallback"));

		assert.equal(snapshot.resetCredits?.availableCount, 3);
		assert.deepEqual(calls.map((call) => call.url), [buildCodexUsageUrl(), buildCodexRateLimitResetCreditsUrl()]);
		assert.equal((calls[0]!.init.headers as Headers).get("chatgpt-account-id"), "acct_fallback");
		assert.equal((calls[1]!.init.headers as Headers).get("authorization")?.startsWith("Bearer "), true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("consumeCodexRateLimitResetCredit posts a redeem request id and parses outcome", async () => {
	const originalFetch = globalThis.fetch;
	const originalRandomUUID = globalThis.crypto.randomUUID;
	let captured: { url: string; init: RequestInit } | undefined;
	try {
		Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => "redeem-request-1" });
		globalThis.fetch = (async (url, init) => {
			captured = { url: String(url), init: init as RequestInit };
			return new Response(JSON.stringify({ code: "reset", windows_reset: 2 }), { status: 200 });
		}) as typeof fetch;

		const result = await consumeCodexRateLimitResetCredit(createCtx("acct_consume"));

		assert.deepEqual(result, { outcome: "reset", windowsReset: 2, raw: { code: "reset", windows_reset: 2 } });
		assert.equal(captured?.url, buildCodexRateLimitResetConsumeUrl());
		assert.equal(captured?.init.method, "POST");
		assert.equal((captured?.init.headers as Headers).get("content-type"), "application/json");
		assert.equal((captured?.init.headers as Headers).get("chatgpt-account-id"), "acct_consume");
		assert.deepEqual(JSON.parse(captured?.init.body as string), { redeem_request_id: "redeem-request-1" });
	} finally {
		Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: originalRandomUUID });
		globalThis.fetch = originalFetch;
	}
});
