import test from "node:test";
import assert from "node:assert/strict";
import {
	parseCodexRateLimitResetCreditsPayload,
	parseCodexUsagePayload,
} from "../src/codex-usage/payload.ts";
import {
	fetchCodexUsage,
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

test("canonical subscription requests use the active alias credential scope", async () => {
	const requestedProviders: string[] = [];
	let requests = 0;
	const token = subscriptionToken("account-alias");
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		requests++;
		return new Response(JSON.stringify({
			rate_limit_reset_credits: { available_count: 0 },
		}), { status: 200 });
	};
	const model = {
		provider: "openai-codex-personal",
		api: "openai-codex-responses",
		id: "gpt-5.6-sol",
		baseUrl: CANONICAL_CODEX_BASE_URL,
	};
	const context = {
		model,
		modelRegistry: {
			getProviderAuth: async (provider: string) => {
				requestedProviders.push(provider);
				return { auth: { apiKey: token, baseUrl: `${CANONICAL_CODEX_BASE_URL}/codex` } };
			},
		},
	} as never;
	const invalidAuthContext = {
		model: {
			...model,
		},
		modelRegistry: {
			getProviderAuth: async () => ({ auth: { apiKey: token, baseUrl: "https://example.com/backend-api" } }),
		},
	} as never;

	try {
		assert.equal((await fetchCodexUsage(context)).resetCredits?.availableCount, 0);
		await assert.rejects(fetchCodexUsage(invalidAuthContext), /canonical.*auth/i);
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.deepEqual(requestedProviders, ["openai-codex-personal"]);
	assert.equal(requests, 1);
});
