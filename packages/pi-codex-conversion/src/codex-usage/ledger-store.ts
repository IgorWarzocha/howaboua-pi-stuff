import { createHash } from "node:crypto";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
	getAgentDir,
	type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type {
	Api,
	AssistantMessage,
	Model,
	Usage,
} from "@earendil-works/pi-ai";
import { isStandardCodexSubscriptionModel } from "../adapter/prompt/codex-model.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";
import type { LedgerOperation, LedgerResult } from "./ledger-operations.ts";
import type { CodexUsageSnapshot } from "./payload.ts";

let lastWriteError: string | undefined;
const pendingGaps = new Map<string, number>();

export function usageLedgerPath(): string {
	return join(getAgentDir(), "codex-usage.json");
}
export function usageAccountKey(accountId: string): string {
	return createHash("sha256").update(accountId).digest("hex");
}

export function runLedgerOperation(
	key: string,
	at: number,
	operation: LedgerOperation,
	path = usageLedgerPath(),
	gaps = 0,
): Promise<LedgerResult> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(
			import.meta.url.endsWith(".ts")
				? new URL("./ledger-worker.ts", import.meta.url)
				: new URL("./ledger-worker.js", import.meta.url),
			{
				workerData: { key, at, operation, path, gaps },
			},
		);
		let result: LedgerResult | undefined;
		let failure: unknown;
		worker.once("message", (message: { result: LedgerResult }) => {
			result = message.result;
		});
		worker.once("error", (error) => {
			failure = error;
		});
		worker.once("exit", (code) => {
			if (failure) reject(failure);
			else if (code !== 0 || !result)
				reject(
					new Error(`Usage ledger operation did not complete (${code}).`),
				);
			else resolve(result);
		});
	});
}

export function usageRecordingError(): string | undefined {
	return lastWriteError;
}

function reportRecordingError(error: unknown): void {
	const message = `Codex usage recording failed: ${error instanceof Error ? error.message : String(error)}`;
	if (message !== lastWriteError) console.warn(message);
	lastWriteError = message;
}

async function recordSafely(
	key: string,
	at: number,
	operation: LedgerOperation,
	recordsSpend = false,
): Promise<void> {
	// Claim gaps before yielding so simultaneous writes never recover the same gap twice.
	const recoveredGaps = pendingGaps.get(key) ?? 0;
	pendingGaps.delete(key);
	try {
		await runLedgerOperation(
			key,
			at,
			operation,
			usageLedgerPath(),
			recoveredGaps,
		);
		lastWriteError = undefined;
	} catch (error) {
		const gaps = recoveredGaps + (recordsSpend ? 1 : 0);
		if (gaps) pendingGaps.set(key, (pendingGaps.get(key) ?? 0) + gaps);
		reportRecordingError(error);
	}
}

export async function recordCodexSpend(
	accountId: string,
	model: Model<Api>,
	usage: Usage,
	at = Date.now(),
): Promise<void> {
	await recordSafely(
		usageAccountKey(accountId),
		at,
		{
			kind: "spend",
			nonstandard: !isStandardCodexSubscriptionModel(model),
			spend: {
				at,
				model: model.id,
				stats: {
					usd: usage.cost.total,
					input: usage.input,
					output: usage.output,
					cacheRead: usage.cacheRead,
					cacheWrite: usage.cacheWrite,
					requests: 1,
					unpriced:
						usage.cost.total === 0 &&
						usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0
							? 1
							: 0,
				},
			},
		},
		true,
	);
}

export async function recordCodexQuota(
	snapshot: CodexUsageSnapshot,
	at = Date.now(),
): Promise<void> {
	if (snapshot.accountKey)
		await recordSafely(snapshot.accountKey, at, { kind: "quota", snapshot });
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
	await recordSafely(key, at, { kind: "manual-reset" });
}
