import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { shellQuote } from "../shell/tokenize.ts";
import { backfillUsage } from "./backfill.ts";
import { readUsageLedger, recordCodexQuota, usageLedgerPath, usageRecordingError } from "./ledger-store.ts";
import type { CodexUsageSnapshot } from "./payload.ts";
import { formatSpendReport, usageReport } from "./spend-report.ts";

export async function startUsageAnalysis(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const session = ctx.sessionManager.getSessionId();
	do { await ctx.waitForIdle(); } while (!ctx.isIdle());
	if (ctx.sessionManager.getSessionId() !== session) return;
	const script = shellQuote(fileURLToPath(new URL(`./analyse.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url)));
	const ledger = shellQuote(usageLedgerPath());
	pi.sendUserMessage([
		"Analyse my Codex spending. Use the bundled read-only report script, starting with its help and summary:",
		`node ${script} --help`,
		`node ${script} summary --file ${ledger}`,
		`Current session directory: ${JSON.stringify(ctx.sessionManager.getSessionDir())}`,
		"Compare reset windows and month trends; inspect bounded session ranges for model and reasoning breakdowns. Distinguish recorded API-equivalent costs, quota estimates and missing coverage. Suggest useful savings without assuming cheaper settings produce equivalent results.",
	].join("\n"));
}

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
