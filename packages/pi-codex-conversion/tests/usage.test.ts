import test from "node:test";
import assert from "node:assert/strict";
import {
	parseCodexRateLimitResetCreditsPayload,
	parseCodexUsagePayload,
} from "../src/ui/settings/usage.ts";

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

test("usage parser keeps a weekly-only window in the weekly column", () => {
	const snapshot = parseCodexUsagePayload({
		rate_limit: {
			primary_window: { used_percent: 25, limit_window_seconds: 604_800, reset_at: 1_800_000_000 },
		},
	});

	assert.equal(snapshot.limits[0]?.primary, undefined);
	assert.equal(snapshot.limits[0]?.secondary?.windowMinutes, 10_080);
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
