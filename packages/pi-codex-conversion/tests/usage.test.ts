import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importUsageHistory } from "../src/codex-usage/backfill.ts";
import { scanUsageHistory } from "../src/codex-usage/history-scan.ts";
import { scanSessionUsage } from "../src/codex-usage/session-analysis.ts";
import { parseCodexReserveStatus } from "../src/codex-usage/reserve-policy.ts";
import { observeWeeklyUsage, recordSpend, usageAccount, WEEK_MS } from "../src/codex-usage/ledger.ts";
import { emptyStats, parseUsageLedger, type UsageLedger } from "../src/codex-usage/ledger-schema.ts";
import { formatSpendReport, usageReport } from "../src/codex-usage/spend-report.ts";
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

test("weekly accounting imports deduplicated pre-tracking costs and freezes windows across late resets", async () => {
	const ledger: UsageLedger = { version: 1, accounts: {} };
	const start = Date.UTC(2026, 0, 1);
	const hour = 3_600_000;
	const cutoff = start + hour / 2;
	const account = usageAccount(ledger, "account", cutoff);
	const snapshot = (reset: number, used: number) => parseCodexUsagePayload({
		rate_limit: { secondary_window: { limit_window_seconds: 604_800, reset_at: reset / 1000, used_percent: used } },
	});
	const spend = (at: number, usd: number, model: string) => recordSpend(account, { at, model, stats: { ...emptyStats(), usd, requests: 1 } });
	observeWeeklyUsage(account, snapshot(start + WEEK_MS, 0), cutoff);
	const root = await mkdtemp(join(tmpdir(), "codex-usage-"));
	try {
		const entry = (id: string, at: number, usd: number, provider = "openai-codex") => JSON.stringify({
			type: "message", id, timestamp: new Date(at).toISOString(),
			message: { role: "assistant", api: "openai-codex-responses", provider, model: "model-a", timestamp: start,
				usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: usd } } },
		});
		const rows = [entry("previous", start - hour, 4), entry("current", start + 1, 2, "renamed"), entry("live", start + hour, 10)].join("\n");
		await writeFile(join(root, "original.jsonl"), rows);
		await writeFile(join(root, "fork.jsonl"), rows);
		let removed = "", scannedUsd = 0;
		const coverage = await scanSessionUsage({ root, from: start - WEEK_MS, to: cutoff }, ({ path, stats }) => {
			scannedUsd += stats.usd;
			if (removed) return;
			removed = path === join(root, "original.jsonl") ? join(root, "fork.jsonl") : join(root, "original.jsonl");
			unlinkSync(removed);
		});
		assert.equal(scannedUsd, 6, "a disappearing copy does not discard healthy costs");
		assert.equal(coverage.unreadablePaths, 1);
		assert.match(coverage.warnings[0]!, /ENOENT/);
		await writeFile(removed, rows);
		const history = await scanUsageHistory(root, start - WEEK_MS, cutoff, start);
		assert.equal(history.coverage.skippedCopies, 2);
		assert.equal(history.total.total.usd, 6); // Request-start timestamps must not re-import live settlements.
		// Ordinary Node must resolve reports without Pi or TypeBox host peers.
		const standalone = join(root, "standalone");
		await mkdir(standalone, { recursive: true });
		await cp(new URL("../src/codex-usage/", import.meta.url), join(standalone, "codex-usage"), { recursive: true });
		await writeFile(join(standalone, "package.json"), '{"type":"module"}');
		const run = (...args: string[]) => {
			const child = spawnSync(process.execPath, [join(standalone, "codex-usage/analyse.ts"), ...args], { encoding: "utf8" });
			assert.equal(child.status, 0, child.stderr);
			return child.stdout;
		};
		assert.match(run("--help"), /Read-only Codex usage analysis/);
		const missingPath = spawnSync(process.execPath, [join(standalone, "codex-usage/analyse.ts"), "summary"], { encoding: "utf8" });
		assert.equal(missingPath.status, 1);
		assert.match(missingPath.stderr, /summary requires --file/);
		assert.deepEqual(JSON.parse(run("history", "--root", root, "--from", new Date(start - WEEK_MS).toISOString(), "--to", new Date(cutoff).toISOString(), "--window-start", new Date(start).toISOString())), history);
		const ledgerFile = join(standalone, "ledger.json");
		const saved = JSON.stringify(ledger);
		await writeFile(ledgerFile, saved);
		const summary = JSON.parse(run("summary", "--file", ledgerFile));
		assert.deepEqual(summary.accounts.account.lifetime, account.total.total);
		assert.equal(await readFile(ledgerFile, "utf8"), saved, "analysis must remain read-only");
		const beforeFailedImport = JSON.stringify(account);
		const emptyFailed = await scanUsageHistory(join(root, "missing"), start - WEEK_MS, cutoff, start);
		assert.throws(() => importUsageHistory(account, emptyFailed, cutoff + 1), /refresh to retry/);
		assert.equal(JSON.stringify(account), beforeFailedImport);
		const partial = structuredClone(account);
		importUsageHistory(partial, { ...history, coverage }, cutoff + 1);
		assert.equal(partial.total.total.usd, 6);
		assert.equal(partial.current?.partial, true);
		assert.match(formatSpendReport(usageReport(partial, cutoff + 1)).join("\n"), /1 unreadable history path/);
		const changedWindow = structuredClone(account);
		observeWeeklyUsage(changedWindow, snapshot(cutoff + hour + WEEK_MS, 0), cutoff + 2 * hour);
		const beforeImport = JSON.stringify(changedWindow);
		assert.throws(() => importUsageHistory(changedWindow, history, cutoff + 3 * hour), /Reset window changed/);
		assert.equal(JSON.stringify(changedWindow), beforeImport);
		importUsageHistory(account, history, cutoff + 1);
		const imported = JSON.stringify(account);
		importUsageHistory(account, history, cutoff + 2);
		assert.equal(JSON.stringify(account), imported);
	} finally { await rm(root, { recursive: true, force: true }); }
	assert.equal(account.current?.summary.total.usd, 2);
	assert.equal(account.current?.partial, false);
	assert.equal(account.current?.quota?.usd, 2);
	const historyWindow = account.closed[String(start - WEEK_MS)]!;
	assert.equal(historyWindow.summary.total.usd, 4);
	assert.equal(historyWindow.approximate, true);
	assert.equal(account.history?.accountIdentity, "unverified");
	assert.equal(account.nonstandard, true);
	const frozenHistory = JSON.stringify(historyWindow);
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
	assert.equal(closed.summary.total.usd, 32);
	assert.equal(closed.summary.models["model:model-a"]?.usd, 12);
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
	assert.equal(Object.keys(account.closed).length, 4);
	assert.equal(account.total.total.usd, 53);
	assert.equal(account.months["2025-12"]?.total.usd, 4);
	assert.equal(account.months["2026-01"]?.total.usd, 49);
	assert.equal(JSON.stringify(account.closed[String(start)]), frozen);
	assert.equal(JSON.stringify(account.closed[String(start - WEEK_MS)]), frozenHistory);
	const now = afterGap + 3 * hour;
	const baseline = usageReport(account, now);
	account.current!.partial = true;
	account.current!.summary.total.unpriced = 1;
	account.total.total.unpriced = 1;
	account.recordingGaps = 1;
	const estimate = usageReport(account, now);
	assert.equal(estimate.spendPerDay, baseline.spendPerDay);
	assert.equal(estimate.vsPreviousWindowPercent, baseline.vsPreviousWindowPercent);
	assert.equal(estimate.vsPreviousMonthPercent, baseline.vsPreviousMonthPercent);
	assert.deepEqual(estimate.models, baseline.models);
	assert.equal(estimate.coverage.unpricedRequests, 1, "analysis retains coverage diagnostics");
	assert.doesNotMatch(formatSpendReport(estimate).join("\n"), /Missing prices|Recording gaps/);
	assert.deepEqual(parseUsageLedger(JSON.parse(JSON.stringify(ledger))), ledger);
});
