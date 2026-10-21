import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { shellQuote } from "../shell/tokenize.ts";
import { backfillUsage, usageSessionRoot } from "./backfill.ts";
import { runLedgerOperation, recordCodexQuota, usageLedgerPath, usageRecordingError } from "./ledger-store.ts";
import type { CodexUsageSnapshot } from "./payload.ts";

export async function startUsageAnalysis(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const session = ctx.sessionManager.getSessionId();
	do { await ctx.waitForIdle(); } while (!ctx.isIdle());
	if (ctx.sessionManager.getSessionId() !== session) return;
	const script = shellQuote(fileURLToPath(new URL(`./analyse.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url)));
	const ledger = shellQuote(usageLedgerPath());
	pi.sendUserMessage([
		"Analyse my Codex spending within the current working directory and its descendants. Use the bundled read-only report script, starting with its help and summary:",
		`node ${script} --help`,
		`node ${script} summary --file ${ledger}`,
		`Session scans: --root ${shellQuote(usageSessionRoot(ctx.sessionManager.getSessionDir()))} --cwd ${shellQuote(ctx.cwd)}`,
		"Compare reset windows and month trends; use bounded session ranges for model and reasoning breakdowns. Ledger totals are machine-wide context, not directory totals. Distinguish recorded API-equivalent costs, quota estimates and missing coverage. Suggest specific folders or sessions for deeper analysis and ask before drilling down.",
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
		options.onProgress?.([...await readSpendReport(snapshot.accountKey), "", "Loading history…"]);
		await backfillUsage(snapshot.accountKey, options.sessionDir, options.signal);
	} catch (error) {
		return [...await readSpendReport(snapshot.accountKey), `History unavailable: ${error instanceof Error ? error.message : String(error)}`];
	}
	return readSpendReport(snapshot.accountKey);
}

export async function readSpendReport(key: string): Promise<string[]> {
	try {
		const result = await runLedgerOperation(key, Date.now(), { kind: "report" });
		if (result.kind !== "report") throw new Error("Usage report unavailable.");
		const { lines } = result;
		const error = usageRecordingError();
		return error ? [...lines, error] : lines;
	} catch (error) { return [`Spend unavailable: ${error instanceof Error ? error.message : String(error)}`]; }
}
