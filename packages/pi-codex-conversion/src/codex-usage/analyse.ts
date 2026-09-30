import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { scanUsageHistory } from "./backfill.ts";
import { readUsageLedger, usageLedgerPath } from "./ledger-store.ts";
import { usageReport } from "./report.ts";
import { analyseSessions } from "./session-analysis.ts";
import { shellQuote } from "../shell/tokenize.ts";

const HELP = `Read-only Codex usage analysis. Outputs JSON; never modifies the ledger or sessions.

node <this-file> summary [--account KEY] [--file LEDGER]
node <this-file> windows [--account KEY] [--from ISO] [--to ISO] [--file LEDGER]
node <this-file> months [--account KEY] [--file LEDGER]
node <this-file> sessions --from ISO --to ISO [--root DIR_OR_JSONL] [--model ID] [--limit 20]
node <this-file> history --from ISO --to ISO --window-start ISO [--root DIR_OR_JSONL]

summary: current/previous window, recorded API-equivalent dollars, tokens, spend/day comparisons, coverage
windows: frozen closed windows with reset provenance, last measured quota and optional final quota estimate
months: UTC calendar-month totals; a month starting before "since" is partial
sessions: model/reasoning groups and top session paths for focused inspection; dates are [from,to)
history: bounded session aggregates for one-time bootstrap; prints JSON without importing it

--file defaults to codex-usage.json in Pi's agent directory
--root defaults to Pi's standard sessions directory; pass the configured session directory if different
--account accepts an exact hashed key; omitted selects all accounts separately

Ledger scope: local requests recorded by Pi-Codex, including native compaction and generated keepalive.
Matches openai-codex-responses regardless of provider name. Nonstandard configurations may produce inaccurate values; aggregator billing is not reconciled.
On first viewing Usage, local sessions bootstrap the current window and an approximate previous week.
Only entries settled before tracking began are imported. Later views read persisted aggregates.
Historical account identity is unverified; local history attaches once to the first viewed account.
Unknown pricing and missing reset observations are explicit.
Costs use prices recorded at request time, not today's rates. They are API equivalents, not subscription charges.
Quota is account-wide and may include other apps/devices; model shares are cost-weighted estimates.
Reset start inferred from next reset minus the reported weekly duration is not a witnessed timestamp.
Closed windows are immutable. Missing intermediate windows cannot be reconstructed from one later observation.

Session analysis does not require a ledger. It reads assistant and model-attributed usage entries,
counts all branches, and deduplicates copied entries across forks. Exact providerThinkingLevel wins;
otherwise the branch's saved thinking setting is labelled session-setting, never claimed as exact effort.
Session files lack reliable account identity. Analysis totals can overlap imported ledger history; do not add them.
Unattributed compaction and unsaved/tool-internal calls may be absent; coverage reports known omissions.
Use top session paths for targeted rg or inspection. Do not dump conversation contents into the report.`;

export async function startUsageAnalysis(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const session = ctx.sessionManager.getSessionId();
	do { await ctx.waitForIdle(); } while (!ctx.isIdle());
	if (ctx.sessionManager.getSessionId() !== session) return;
	const script = shellQuote(fileURLToPath(import.meta.url));
	pi.sendUserMessage([
		"Analyse my Codex spending. Use the bundled read-only report script, starting with its help and summary:",
		`node ${script} --help`,
		`node ${script} summary`,
		`Current session directory: ${JSON.stringify(ctx.sessionManager.getSessionDir())}`,
		"Compare reset windows and month trends; inspect bounded session ranges for model and reasoning breakdowns. Distinguish recorded API-equivalent costs, quota estimates and missing coverage. Suggest useful savings without assuming cheaper settings produce equivalent results.",
	].join("\n"));
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			help: { type: "boolean", short: "h" }, account: { type: "string" }, file: { type: "string" },
			from: { type: "string" }, to: { type: "string" }, root: { type: "string" }, model: { type: "string" }, limit: { type: "string" },
			"window-start": { type: "string" },
		},
	});
	if (values.help) { process.stdout.write(`${HELP}\n`); return; }
	const action = positionals[0] ?? "summary";
	if (positionals.length > 1 || !["summary", "windows", "months", "sessions", "history"].includes(action)) throw new Error("Expected summary, windows, months, sessions or history. Use --help.");
	const from = values.from ? Date.parse(values.from) : 0;
	const to = values.to ? Date.parse(values.to) : Date.now();
	if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("Provide valid ISO dates with --from before --to.");
	if (values["window-start"] && action !== "history") throw new Error("--window-start applies only to history.");
	let result: unknown;
	if (action === "history" || action === "sessions") {
		if (!values.from || !values.to) throw new Error(`${action} requires --from and --to to bound the scan.`);
		if (values.account || values.file) throw new Error("Session files cannot be reliably filtered by ledger account.");
		const root = values.root ?? join(getAgentDir(), "sessions");
		if (action === "history") {
			const windowStart = Date.parse(values["window-start"] ?? "");
			if (!Number.isFinite(windowStart) || windowStart <= from) throw new Error("history requires --window-start after --from.");
			if (values.model || values.limit) throw new Error("--model and --limit apply only to sessions.");
			result = await scanUsageHistory(root, from, to, windowStart);
		} else {
			const limit = values.limit === undefined ? 20 : Number(values.limit);
			if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be an integer from 1 to 1000.");
			result = await analyseSessions({ root, from, to, model: values.model, limit });
		}
	} else {
		if (values.root || values.model || values.limit) throw new Error("--root applies only to session scans; --model and --limit apply only to sessions.");
		const path = values.file ?? usageLedgerPath();
		const ledger = readUsageLedger(path);
		if (values.account && !Object.hasOwn(ledger.accounts, values.account)) throw new Error("Account not found in the ledger.");
		result = {
			file: path,
			accounts: Object.fromEntries(Object.entries(ledger.accounts).filter(([key]) => !values.account || key === values.account).map(([key, account]) => [
				key, action === "summary" ? usageReport(account)
					: action === "months" ? { since: account.since, months: account.months }
						: Object.values(account.closed).filter((window) => window.start < to && window.end > from).sort((a, b) => a.start - b.start),
			])),
		};
	}
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
