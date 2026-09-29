import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexReserveStatus } from "../src/codex-usage/reserve-policy.ts";
import { observeWeeklyUsage, recordSpend, usageAccount, WEEK_MS } from "../src/codex-usage/ledger.ts";
import { emptyStats, parseUsageLedger, type UsageLedger } from "../src/codex-usage/ledger-schema.ts";
import {
	codexUsageStatus,
	parseCodexRateLimitResetCreditsPayload,
	parseCodexUsagePayload,
} from "../src/codex-usage/payload.ts";

test("usage normalization separates canonical quota windows from account-bound reserve switching", () => {
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
	assert.deepEqual(codexUsageStatus(snapshot), { fiveHourUsageLeft: 0, weeklyUsageLeft: undefined });
	const identity = { accountId: "account-a", userId: "user-a" };
	const denied = { accountKey: JSON.stringify([identity.accountId, identity.userId]), entryAllowed: false, ordinaryUsageRecovered: false };
	assert.deepEqual(parseCodexReserveStatus(payload, identity, "gpt-6-astra"), denied);
	const offered = { ...payload, rate_limit_upsell: { banner_type: "luna_reserve", blocked_model_slug: "gpt-6-astra" } };
	assert.deepEqual(parseCodexReserveStatus(offered, identity, "gpt-6-astra"), { ...denied, entryAllowed: true });
	assert.equal(parseCodexReserveStatus(offered, { ...identity, accountId: "account-b" }, "gpt-6-astra"), undefined);
	assert.equal(parseCodexRateLimitResetCreditsPayload({ available_count: "1", credits: [] })?.availableCount, 1);
	assert.equal(parseCodexRateLimitResetCreditsPayload({ available_count: "unknown" }), undefined);
});

test("weekly accounting splits a late-discovered reset without rewriting closed windows or fabricating gaps", () => {
	const ledger: UsageLedger = { version: 1, accounts: {} };
	const start = Date.UTC(2026, 0, 1);
	const hour = 3_600_000;
	const account = usageAccount(ledger, "account", start);
	const snapshot = (reset: number, used: number) => parseCodexUsagePayload({
		rate_limit: { secondary_window: { limit_window_seconds: 604_800, reset_at: reset / 1000, used_percent: used } },
	});
	const spend = (at: number, usd: number, model: string) => recordSpend(account, { at, model, stats: { ...emptyStats(), usd, requests: 1 } });
	observeWeeklyUsage(account, snapshot(start + WEEK_MS, 0), start + 1);
	spend(start + hour, 10, "model-a");
	observeWeeklyUsage(account, snapshot(start + WEEK_MS, 10), start + 2 * hour);
	spend(start + 3 * hour, 20, "model-b");
	observeWeeklyUsage(account, snapshot(start + WEEK_MS, 30), start + 4 * hour);
	const early = start + 5 * hour;
	spend(early + hour, 7, "model-a");
	observeWeeklyUsage(account, snapshot(early + WEEK_MS, 7), early + 2 * hour);
	const closed = account.closed[String(start)]!;
	assert.equal(closed.end, early);
	assert.equal(closed.reason, "early");
	assert.equal(closed.summary.total.usd, 30);
	assert.equal(closed.summary.models["model:model-a"]?.usd, 10);
	assert.equal(closed.quotaEstimate, 30);
	assert.equal(account.current?.summary.total.usd, 7);
	assert.equal(account.unassignedUsd, 0);
	const frozen = JSON.stringify(closed);
	spend(early + 3 * hour, 3, "model-b");
	observeWeeklyUsage(account, snapshot(early + WEEK_MS, 10), early + 4 * hour);
	// Old replies and contradictory reset predictions cannot move the boundary backwards.
	observeWeeklyUsage(account, snapshot(start + WEEK_MS, 30), start + 4 * hour);
	observeWeeklyUsage(account, snapshot(early + WEEK_MS - 2 * hour, 10), early + 5 * hour);
	assert.equal(account.current?.start, early);
	assert.equal(JSON.stringify(account.closed[String(start)]), frozen);

	const next = early + WEEK_MS;
	spend(next + hour, 5, "model-b");
	observeWeeklyUsage(account, snapshot(next + WEEK_MS, 5), next + 2 * hour);
	assert.equal(account.closed[String(early)]?.summary.total.usd, 10);
	assert.equal(account.current?.summary.total.usd, 5);
	const afterGap = next + 3 * WEEK_MS;
	spend(afterGap + hour, 2, "model-a");
	observeWeeklyUsage(account, snapshot(afterGap + WEEK_MS, 2), afterGap + 2 * hour);
	assert.equal(account.closed[String(next)]?.reason, "gap");
	assert.equal(account.closed[String(next)]?.partial, true);
	assert.equal(Object.keys(account.closed).length, 3);
	assert.equal(account.total.total.usd, 47);
	assert.equal(JSON.stringify(account.closed[String(start)]), frozen);
	assert.deepEqual(parseUsageLedger(JSON.parse(JSON.stringify(ledger))), ledger);
});
