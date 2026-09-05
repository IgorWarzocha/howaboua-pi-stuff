import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexReserveStatus } from "../src/codex-usage/reserve-policy.ts";
import {
	parseCodexRateLimitResetCreditsPayload,
	parseCodexUsagePayload,
} from "../src/codex-usage/payload.ts";

test("usage normalization keeps reserve display separate from account-bound switching", () => {
	const payload = {
		account_id: "account-a",
		user_id: "user-a",
		plan_type: "pro",
		rate_limit_reset_credits: { available_count: 2 },
		rate_limit: {
			allowed: false,
			primary_window: { used_percent: 100, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
		},
		additional_rate_limits: [{
			metered_feature: "base_model_inference", limit_name: "gpt-reserve",
			rate_limit: { primary_window: { used_percent: 48, limit_window_seconds: 604_800 } },
		}],
	};
	const snapshot = parseCodexUsagePayload(payload);
	assert.equal(snapshot.resetCredits?.availableCount, 2);
	assert.deepEqual(snapshot.limits[1], { limitId: "base_model_inference", limitName: "gpt-reserve", secondary: { usedPercent: 48, windowMinutes: 10_080, resetsAt: undefined } });
	const identity = { accountId: "account-a", userId: "user-a" };
	const denied = { accountKey: JSON.stringify([identity.accountId, identity.userId]), entryAllowed: false, ordinaryUsageRecovered: false };
	assert.deepEqual(parseCodexReserveStatus(payload, identity, "gpt-6-astra"), denied);
	const offered = { ...payload, rate_limit_upsell: { banner_type: "luna_reserve", blocked_model_slug: "gpt-6-astra" } };
	assert.deepEqual(parseCodexReserveStatus(offered, identity, "gpt-6-astra"), { ...denied, entryAllowed: true });
	assert.deepEqual(parseCodexReserveStatus(offered, identity, "gpt-5.6-luna"), denied);
	assert.equal(parseCodexReserveStatus(offered, { ...identity, accountId: "account-b" }, "gpt-6-astra"), undefined);
	assert.equal(parseCodexReserveStatus(offered, { ...identity, userId: "user-b" }, "gpt-6-astra"), undefined);
	const recovered = { ...payload, rate_limit: { allowed: true } };
	assert.deepEqual(parseCodexReserveStatus(recovered, identity, "gpt-reserve"), { ...denied, ordinaryUsageRecovered: true });
	for (const blocked of [
		{ ...recovered, rate_limit_upsell: { banner_type: "unknown" } },
		{ ...recovered, spend_control: { reached: true } },
		{ ...recovered, rate_limit_reached_type: "spend_limit" },
		{ ...recovered, rate_limit: undefined, credits: { unlimited: true } },
	]) assert.deepEqual(parseCodexReserveStatus(blocked, identity, "gpt-reserve"), denied);
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
