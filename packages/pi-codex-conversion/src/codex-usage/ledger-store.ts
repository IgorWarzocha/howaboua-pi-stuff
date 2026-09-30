import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { getAgentDir, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import { isStandardCodexSubscriptionModel } from "../adapter/prompt/codex-model.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";
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

function reportRecordingError(error: unknown): void {
	const message = `Codex usage recording failed: ${error instanceof Error ? error.message : String(error)}`;
	if (message !== lastWriteError) console.warn(message);
	lastWriteError = message;
}

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

async function recordSafely(key: string, at: number, update: (account: UsageAccount) => void, recordsSpend = false): Promise<void> {
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
		if (recordsSpend) pendingGaps.set(key, (pendingGaps.get(key) ?? 0) + 1);
		reportRecordingError(error);
	}
}

export async function recordCodexSpend(accountId: string, model: Model<Api>, usage: Usage, at = Date.now()): Promise<void> {
	await recordSafely(usageAccountKey(accountId), at, (account) => {
		if (!isStandardCodexSubscriptionModel(model)) account.nonstandard = true;
		recordSpend(account, {
			at, model: model.id,
			stats: {
				usd: usage.cost.total, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
				requests: 1, unpriced: usage.cost.total === 0 && usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0 ? 1 : 0,
			},
		});
	}, true);
}

export async function recordCodexQuota(snapshot: CodexUsageSnapshot, at = Date.now()): Promise<void> {
	if (snapshot.accountKey) await recordSafely(snapshot.accountKey, at, (account) => {
		if (snapshot.nonstandard) account.nonstandard = true;
		observeWeeklyUsage(account, snapshot, at);
	});
}

export async function recordCodexProxyMessage(message: AssistantMessage, registry: ModelRegistry): Promise<void> {
	// Native responses, compaction and keepalive already record inside the Codex transport.
	if (message.api !== "openai-codex-responses" || message.provider === "openai-codex"
		|| message.stopReason === "pending") return;
	const { usage } = message;
	if ((message.stopReason === "error" || message.stopReason === "aborted") && usage.cost.total === 0
		&& usage.input + usage.output + usage.cacheRead + usage.cacheWrite === 0) return;
	const at = Date.now();
	try {
		const model = registry.find(message.provider, message.model);
		if (!model) throw new Error(`Model unavailable: ${message.provider}/${message.model}`);
		const auth = await registry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(auth.error);
		const accountId = extractAccountId(auth.apiKey ?? "");
		await recordCodexSpend(accountId, auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model, usage, at);
	} catch (error) { reportRecordingError(error); }
}

export async function recordCodexManualReset(key: string): Promise<void> {
	const at = Date.now();
	await recordSafely(key, at, (account) => { account.manualResetAt = at; });
}
