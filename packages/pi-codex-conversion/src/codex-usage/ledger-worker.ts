import { randomUUID } from "node:crypto";
import {
	mkdir,
	open,
	readFile,
	rename,
	rm,
	writeFile,
	type FileHandle,
} from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
import { observeWeeklyUsage, recordSpend, usageAccount, WEEK_MS } from "./ledger.ts";
import {
	parseUsageLedger,
	type UsageAccount,
	type UsageLedger,
} from "./ledger-schema.ts";
import { readUsageLedgerFile } from "./ledger-read.ts";
import { importUsageHistory } from "./history-import.ts";
import { formatSpendReport, usageReport } from "./spend-report.ts";
import type { LedgerRequest, LedgerResult } from "./ledger-operations.ts";

async function acquireLock(path: string): Promise<FileHandle> {
	const deadline = Date.now() + 2_000;
	while (true) {
		try {
			const fd = await open(path, "wx", 0o600);
			try {
				await fd.writeFile(`${process.pid}\n`);
			} catch (error) {
				try {
					await fd.close();
				} finally {
					await rm(path, { force: true });
				}
				throw error;
			}
			return fd;
		} catch (error) {
			if (
				!(
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === "EEXIST"
				)
			)
				throw error;
			if (Date.now() >= deadline)
				throw new Error(
					`Usage ledger is locked: ${path}. If its recorded PID is no longer running, remove the stale lock.`,
				);
			await setTimeout(25);
		}
	}
}

// Multiple Pi sessions write the same account. Lock the entire read/modify/rename,
// not just the final write; atomic rename alone loses simultaneous completions.
async function updateUsageLedger(
	key: string,
	at: number,
	update: (account: UsageAccount, ledger: UsageLedger) => void,
	path: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const lock = `${path}.lock`;
	const fd = await acquireLock(lock);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		let ledger: UsageLedger;
		try {
			ledger = parseUsageLedger(JSON.parse(await readFile(path, "utf8")));
		} catch (error) {
			if (
				!(
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === "ENOENT"
				)
			)
				throw error;
			ledger = { version: 1, accounts: {} };
		}
		update(usageAccount(ledger, key, at), ledger);
		parseUsageLedger(ledger);
		// The worker owns CPU processing and holds the lock through replacement and cleanup.
		await writeFile(temporary, JSON.stringify(ledger), {
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporary, path);
	} finally {
		try {
			await rm(temporary, { force: true });
		} finally {
			try {
				await fd.close();
			} finally {
				await rm(lock, { force: true });
			}
		}
	}
}

function historyRange(ledger: UsageLedger, key: string): Extract<LedgerResult, { kind: "history" }> | undefined {
	const account = ledger.accounts[key];
	if (!account?.current || account.since <= account.current.start - WEEK_MS || account.history
		|| (ledger.historyOwner && ledger.historyOwner !== key)) return;
	return { kind: "history", start: account.current.start, to: account.since };
}

async function execute(request: LedgerRequest): Promise<LedgerResult> {
	const { path, key } = request;
	if (request.operation.kind === "report") {
		const ledger = readUsageLedgerFile(path),
			account = ledger.accounts[key];
		const lines = account
			? formatSpendReport(usageReport(account))
			: ["No tracked spend yet."];
		if (!account?.history && ledger.historyOwner && ledger.historyOwner !== key)
			lines.push("History linked to another account");
		return { kind: "report", lines };
	}
	// Most refreshes have nothing to import. Avoid rewriting the ledger just to
	// discover that; eligible reservations are checked again under the lock.
	if (request.operation.kind === "reserve-history" && !historyRange(readUsageLedgerFile(path), key))
		return { kind: "updated" };
	let result: LedgerResult = { kind: "updated" };
	await updateUsageLedger(
		key,
		request.at,
		(account, ledger) => {
			const operation = request.operation;
			if (operation.kind === "reserve-history") {
				const range = historyRange(ledger, key);
				if (!range) return;
				// The first viewer keeps ownership across interruptions and can retry.
				ledger.historyOwner = key;
				result = range;
				return;
			}
			if (operation.kind === "import-history") {
				if (
					!account.history &&
					(!ledger.historyOwner || ledger.historyOwner === key)
				)
					importUsageHistory(account, operation.history, request.at);
				return;
			}
			account.recordingGaps += request.gaps;
			if (request.gaps && account.current) account.current.partial = true;
			if (operation.kind === "spend") {
				if (operation.nonstandard) account.nonstandard = true;
				recordSpend(account, operation.spend);
			} else if (operation.kind === "quota") {
				if (operation.snapshot.nonstandard) account.nonstandard = true;
				observeWeeklyUsage(account, operation.snapshot, request.at);
			} else if (operation.kind === "manual-reset")
				account.manualResetAt = request.at;
		},
		path,
	);
	return result;
}

// No persistent worker or unawaited writes: the caller settles only after this
// worker exits, after the transaction's finally block has released its lock.
parentPort!.postMessage({ result: await execute(workerData as LedgerRequest) });
