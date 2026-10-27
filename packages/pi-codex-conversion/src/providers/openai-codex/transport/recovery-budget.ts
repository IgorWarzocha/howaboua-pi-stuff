import { DEFAULT_MAX_RETRY_DELAY_MS, DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS, DEFAULT_STREAM_MAX_RETRIES, DEFAULT_TRANSPORT_RECOVERY_BUDGET_MS, INITIAL_STREAM_RETRY_DELAY_MS, MAX_STREAM_MAX_RETRIES } from "../constants.ts";
import { NonRetryableProviderError } from "../errors.ts";
import { codexOverloadRetryDelay, codexStreamRetryDelay, isCodexOverloadError, isCodexRateLimitError } from "../stream-events.ts";
import { combineAbortSignals, sleep } from "../sse.ts";
import type { OpenAICodexStreamOptions } from "../types.ts";

function codexStreamRetryDelayMs(retryCount: number): number {
	const base = INITIAL_STREAM_RETRY_DELAY_MS * 2 ** Math.max(0, retryCount - 1);
	return Math.min(DEFAULT_MAX_RETRY_DELAY_MS, base * (0.9 + Math.random() * 0.2));
}

export function codexStreamMaxRetries(options: OpenAICodexStreamOptions | undefined): number {
	const configured = options?.maxRetries;
	if (configured === undefined) return DEFAULT_STREAM_MAX_RETRIES;
	if (!Number.isFinite(configured) || configured < 0) {
		throw new Error(`Invalid maxRetries: ${String(configured)}`);
	}
	return Math.min(Math.floor(configured), MAX_STREAM_MAX_RETRIES);
}

export function retryAdviceRecoveryBudgetError(error: unknown): NonRetryableProviderError {
	const requestedDelayMs = codexStreamRetryDelay(error);
	const detail = requestedDelayMs === undefined ? "" : ` Provider requested a wait of ${Math.ceil(requestedDelayMs / 1000)} seconds.`;
	return new NonRetryableProviderError(`Codex retry delay exceeded the three-minute automatic recovery window.${detail}`);
}

export class CodexRecoveryBudget {
	private overloadRetryCount = 0;
	private adviceStartedAt: number | undefined;
	private adviceController: AbortController | undefined;
	private adviceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly callerSignal: AbortSignal | undefined;
	recoveryDeadlineAt: number | undefined;
	recoveryController: AbortController | undefined;
	private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
	constructor(callerSignal?: AbortSignal) { this.callerSignal = callerSignal; }
	close(): void {
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
		if (this.adviceTimer) clearTimeout(this.adviceTimer);
	}
	signal = () => this.recoveryController || this.adviceController
		? combineAbortSignals([this.callerSignal, this.recoveryController?.signal, this.adviceController?.signal])
		: undefined;
	start = (freshWindow = false) => {
		if (freshWindow) {
			if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
			this.recoveryDeadlineAt = undefined;
		}
		if (this.recoveryDeadlineAt !== undefined) return;
		// Never charge a long, healthy initial response against the recovery window.
		this.recoveryDeadlineAt = performance.now() + DEFAULT_TRANSPORT_RECOVERY_BUDGET_MS;
		this.recoveryController = new AbortController();
		this.recoveryTimer = setTimeout(() => this.recoveryController?.abort(), DEFAULT_TRANSPORT_RECOVERY_BUDGET_MS);
	};
	deadlineError = () => this.adviceExpired() ? retryAdviceRecoveryBudgetError(undefined) : new NonRetryableProviderError(
		"Codex could not complete transport recovery within five minutes; the request was stopped before an answer completed. Retry the request.",
	);
	private adviceExpired = () => this.adviceController?.signal.aborted === true
		|| (this.adviceStartedAt !== undefined && performance.now() - this.adviceStartedAt >= DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS);
	expired = () => this.adviceExpired() || this.recoveryController?.signal.aborted === true
		|| (this.recoveryDeadlineAt !== undefined && performance.now() >= this.recoveryDeadlineAt);
	planRetry = (error: unknown, retryCount: number) => {
		const overload = isCodexOverloadError(error);
		const requestedDelayMs = codexStreamRetryDelay(error);
		const serverDirected = requestedDelayMs !== undefined || isCodexRateLimitError(error);
		// One logical request owns this clock, including attempts and SSE fallback.
		if ((overload || serverDirected) && this.adviceStartedAt === undefined) {
			this.adviceStartedAt = performance.now();
			this.adviceController = new AbortController();
			this.adviceTimer = setTimeout(() => this.adviceController?.abort(), DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS);
		}
		const elapsedMs = this.adviceStartedAt === undefined ? 0 : performance.now() - this.adviceStartedAt;
		const fallbackDelayMs = codexStreamRetryDelayMs(retryCount);
		const delayMs = overload
			? codexOverloadRetryDelay(error, this.overloadRetryCount, elapsedMs)
			: requestedDelayMs ?? fallbackDelayMs;
		const adviceBudgetExhausted = (overload || serverDirected) && (this.adviceExpired() || delayMs === undefined
			|| delayMs > Math.max(0, DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS - elapsedMs));
		return {
			overload,
			serverDirected,
			adviceBudgetExhausted,
			delayMs: adviceBudgetExhausted ? undefined : delayMs,
		};
	};
	waitBeforeRetry = async (error: unknown, retryCount: number, plan = this.planRetry(error, retryCount), switchingOnExpiry = false) => {
		if (plan.delayMs === undefined) throw retryAdviceRecoveryBudgetError(error);
		// Hooks and diagnostics may take time. Expired advice means zero,
		// not another full delay or a fresh local backoff.
		const delayMs = codexStreamRetryDelay(error) ?? plan.delayMs;
		if (this.adviceStartedAt !== undefined && (this.adviceExpired()
			|| delayMs > Math.max(0, DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS - (performance.now() - this.adviceStartedAt)))) {
			throw retryAdviceRecoveryBudgetError(error);
		}
		if (!switchingOnExpiry && this.recoveryDeadlineAt !== undefined && delayMs > Math.max(0, this.recoveryDeadlineAt - performance.now())) {
			throw new NonRetryableProviderError("Codex retry advice exceeds the remaining transport recovery window; retry the request later.");
		}
		const retrySignal = this.signal();
		try {
			await sleep(delayMs, retrySignal?.signal ?? this.callerSignal);
		} catch (error) {
			if (!this.callerSignal?.aborted && this.expired()) throw this.deadlineError();
			throw error;
		} finally {
			retrySignal?.cleanup();
		}
		if (plan.overload) {
			this.overloadRetryCount++;
		}
	};
}
