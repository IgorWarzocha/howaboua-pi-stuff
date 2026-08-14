import test from "node:test";
import assert from "node:assert/strict";
import {
	parseCodexRateLimitResetCreditsPayload,
	parseCodexUsagePayload,
} from "../src/codex-usage/payload.ts";
import {
	consumeCodexRateLimitResetCredit,
	fetchCodexUsage,
	fetchCodexWeeklyUsageLeft,
} from "../src/codex-usage/client.ts";

const CANONICAL_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function subscriptionToken(accountId: string): string {
	const payload = Buffer.from(JSON.stringify({
		"https://api.openai.com/auth": { chatgpt_account_id: accountId },
	})).toString("base64url");
	return `header.${payload}.signature`;
}

test("usage parser reads reset-credit summary", () => {
	const snapshot = parseCodexUsagePayload({
		plan_type: "pro",
		rate_limit_reset_credits: { available_count: 2 },
		rate_limit: {
			primary_window: { used_percent: 100, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
		},
	});

	assert.equal(snapshot.resetCredits?.availableCount, 2);
});

test("reset-credit parser normalizes the standalone API payload", () => {
	const credits = parseCodexRateLimitResetCreditsPayload({
		available_count: "1",
		credits: [{
			id: "RateLimitResetCredit_1",
			reset_type: "codex_rate_limits",
			status: "available",
			granted_at: "2026-06-12T01:31:33.351888Z",
			expires_at: "2026-07-12T01:31:33.351888Z",
			redeem_started_at: null,
			redeemed_at: null,
			title: "One free rate limit reset",
			description: "Thanks for using Codex!",
		}],
	});

	assert.ok(credits);
	assert.equal(credits.availableCount, 1);
	assert.deepEqual(credits.credits, [{
		id: "RateLimitResetCredit_1",
		resetType: "codex_rate_limits",
		status: "available",
		grantedAt: "2026-06-12T01:31:33.351888Z",
		expiresAt: "2026-07-12T01:31:33.351888Z",
		redeemStartedAt: undefined,
		redeemedAt: undefined,
		title: "One free rate limit reset",
		description: "Thanks for using Codex!",
	}]);
});

test("canonical aliases use their own credential scope for usage and reset credits", async () => {
	const requestedProviders: string[] = [];
	const requests: Array<{ url: string; method: string }> = [];
	const token = subscriptionToken("account-alias-regression");
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? "GET" });
		if (url.endsWith("/consume")) {
			return new Response(JSON.stringify({ code: "reset", windows_reset: 2 }), { status: 200 });
		}
		return new Response(JSON.stringify({
			rate_limit: {
				secondary_window: { used_percent: 25, limit_window_seconds: 604_800 },
			},
			rate_limit_reset_credits: { available_count: 0 },
		}), { status: 200 });
	};
	const ctx = {
		model: {
			provider: "openai-codex-personal",
			api: "openai-codex-responses",
			id: "gpt-5.6-sol",
			baseUrl: CANONICAL_CODEX_BASE_URL,
		},
		modelRegistry: {
			getProviderAuth: async (provider: string) => {
				requestedProviders.push(provider);
				return { auth: { apiKey: token, baseUrl: `${CANONICAL_CODEX_BASE_URL}/codex` } };
			},
		},
	} as never;

	try {
		assert.equal(await fetchCodexWeeklyUsageLeft(ctx), 75);
		assert.equal((await fetchCodexUsage(ctx)).resetCredits?.availableCount, 0);
		assert.equal((await consumeCodexRateLimitResetCredit(ctx, "redeem-alias")).outcome, "reset");
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.deepEqual(requestedProviders, [
		"openai-codex-personal",
		"openai-codex-personal",
		"openai-codex-personal",
	]);
	assert.ok(requestedProviders.every((provider) => provider !== "openai-codex"));
	assert.deepEqual(requests.map(({ method }) => method), ["GET", "GET", "POST"]);
});

test("stock Codex OAuth auth inherits the canonical model endpoint", async () => {
	const requestedProviders: string[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({
		rate_limit_reset_credits: { available_count: 0 },
	}), { status: 200 });
	const ctx = {
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.6-sol",
			baseUrl: CANONICAL_CODEX_BASE_URL,
		},
		modelRegistry: {
			getProviderAuth: async (provider: string) => {
				requestedProviders.push(provider);
				return { auth: { apiKey: subscriptionToken("account-stock-regression") } };
			},
		},
	} as never;

	try {
		assert.equal((await fetchCodexUsage(ctx)).resetCredits?.availableCount, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.deepEqual(requestedProviders, ["openai-codex"]);
});

test("noncanonical Codex API models cannot access subscription usage", async () => {
	let authRequested = false;
	const ctx = {
		model: {
			provider: "some-proxy",
			api: "openai-codex-responses",
			id: "gpt-5.6-sol",
			baseUrl: "https://example.com/backend-api",
		},
		modelRegistry: {
			getProviderAuth: async () => {
				authRequested = true;
				return undefined;
			},
		},
	} as never;

	await assert.rejects(fetchCodexUsage(ctx), /canonical|subscription/i);
	assert.equal(await fetchCodexWeeklyUsageLeft(ctx), undefined);
	await assert.rejects(consumeCodexRateLimitResetCredit(ctx), /canonical|subscription/i);
	assert.equal(authRequested, false);
});

test("stock Codex custom endpoints retain transport behavior but cannot access subscription usage", async () => {
	let authRequested = false;
	const ctx = {
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.6-sol",
			baseUrl: "https://codex-proxy.example.com/backend-api",
		},
		modelRegistry: {
			getProviderAuth: async () => {
				authRequested = true;
				return undefined;
			},
		},
	} as never;

	await assert.rejects(fetchCodexUsage(ctx), /canonical|subscription/i);
	assert.equal(await fetchCodexWeeklyUsageLeft(ctx), undefined);
	await assert.rejects(consumeCodexRateLimitResetCredit(ctx), /canonical|subscription/i);
	assert.equal(authRequested, false);
});
