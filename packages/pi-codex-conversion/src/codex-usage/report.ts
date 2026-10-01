import { backfillUsage } from "./backfill.ts";
import { readUsageLedger, recordCodexQuota, usageRecordingError } from "./ledger-store.ts";
import type { CodexUsageSnapshot } from "./payload.ts";
import { formatSpendReport, usageReport } from "./spend-report.ts";

export async function captureSpendReport(snapshot: CodexUsageSnapshot, options: {
	sessionDir: string;
	signal?: AbortSignal | undefined;
	onProgress?: (lines: string[]) => void;
}): Promise<string[]> {
	if (!snapshot.accountKey) return [];
	await recordCodexQuota(snapshot);
	try {
		const pending = backfillUsage(snapshot.accountKey, options.sessionDir, options.signal);
		if (pending) {
			options.onProgress?.([...readSpendReport(snapshot.accountKey), "", "Loading history…"]);
			await pending;
		}
	} catch (error) {
		return [...readSpendReport(snapshot.accountKey), `History unavailable: ${error instanceof Error ? error.message : String(error)}`];
	}
	return readSpendReport(snapshot.accountKey);
}

export function readSpendReport(key: string): string[] {
	try {
		const ledger = readUsageLedger();
		const account = ledger.accounts[key];
		const lines = account ? formatSpendReport(usageReport(account)) : ["No tracked spend yet."];
		if (!account?.history && ledger.historyOwner && ledger.historyOwner !== key) lines.push("History linked to another account");
		const error = usageRecordingError();
		return error ? [...lines, error] : lines;
	} catch (error) { return [`Spend unavailable: ${error instanceof Error ? error.message : String(error)}`]; }
}
