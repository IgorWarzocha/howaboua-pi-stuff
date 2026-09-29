import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { observeWeeklyUsage, recordSpend, usageAccount } from "./ledger.ts";
import { parseUsageLedger, type UsageAccount, type UsageLedger } from "./ledger-schema.ts";
import type { CodexUsageSnapshot } from "./payload.ts";

let lastWriteError: string | undefined;
const pendingGaps = new Map<string, number>();

export function usageLedgerPath(): string { return join(getAgentDir(), "codex-usage.json"); }
export function usageAccountKey(accountId: string): string { return createHash("sha256").update(accountId).digest("hex"); }

export function readUsageLedger(path = usageLedgerPath()): UsageLedger {
	try { return parseUsageLedger(JSON.parse(readFileSync(path, "utf8"))); }
	catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { version: 1, accounts: {} };
		throw error;
	}
}

export function usageRecordingError(): string | undefined { return lastWriteError; }

async function acquireLock(path: string): Promise<number> {
	const deadline = Date.now() + 2_000;
	while (true) {
		try {
			const fd = openSync(path, "wx", 0o600);
			try { writeFileSync(fd, `${process.pid}\n`); }
			catch (error) { closeSync(fd); rmSync(path, { force: true }); throw error; }
			return fd;
		} catch (error) {
			if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
			if (Date.now() >= deadline) throw new Error(`Usage ledger is locked: ${path}. If its recorded PID is no longer running, remove the stale lock.`);
			await setTimeout(25);
		}
	}
}

// Multiple Pi sessions write the same account. Lock the entire read/modify/rename,
// not just the final write; atomic rename alone loses simultaneous completions.
export async function updateUsageLedger(key: string, at: number, update: (account: UsageAccount, ledger: UsageLedger) => void, path = usageLedgerPath()): Promise<void> {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const lock = `${path}.lock`;
	const fd = await acquireLock(lock);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		const ledger = readUsageLedger(path);
		update(usageAccount(ledger, key, at), ledger);
		parseUsageLedger(ledger);
		writeFileSync(temporary, JSON.stringify(ledger), { mode: 0o600, flag: "wx" });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
		closeSync(fd);
		rmSync(lock, { force: true });
	}
}

async function recordSafely(key: string, at: number, update: (account: UsageAccount) => void): Promise<void> {
	let recoveredGaps = 0;
	try {
		await updateUsageLedger(key, at, (account) => {
			recoveredGaps = pendingGaps.get(key) ?? 0;
			account.recordingGaps += recoveredGaps;
			if (recoveredGaps && account.current) account.current.partial = true;
			update(account);
		});
		const remaining = (pendingGaps.get(key) ?? 0) - recoveredGaps;
		if (remaining > 0) pendingGaps.set(key, remaining);
		else pendingGaps.delete(key);
		lastWriteError = undefined;
	}
	catch (error) {
		pendingGaps.set(key, (pendingGaps.get(key) ?? 0) + 1);
		const message = `Codex usage recording failed: ${error instanceof Error ? error.message : String(error)}`;
		if (message !== lastWriteError) console.warn(message);
		lastWriteError = message;
	}
}

export async function recordCodexSpend(accountId: string, model: string, usage: Usage, at = Date.now()): Promise<void> {
	await recordSafely(usageAccountKey(accountId), at, (account) => recordSpend(account, {
		at, model,
		stats: {
			usd: usage.cost.total, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
			requests: 1, unpriced: usage.cost.total === 0 ? 1 : 0,
		},
	}));
}

export async function recordCodexQuota(snapshot: CodexUsageSnapshot, at = Date.now()): Promise<void> {
	if (snapshot.accountKey) await recordSafely(snapshot.accountKey, at, (account) => observeWeeklyUsage(account, snapshot, at));
}

export async function recordCodexManualReset(key: string): Promise<void> {
	const at = Date.now();
	await recordSafely(key, at, (account) => { account.manualResetAt = at; });
}
