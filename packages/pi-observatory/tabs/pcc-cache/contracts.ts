/** Metadata-only snapshot. Cache measurements never infer hits from transport or continuation. */
export interface CacheRequest {
	id: string;
	time: string;
	sessionId: string | null;
	sessionName: string | null;
	project: string | null;
	model: string;
	lane: string;
	scope: string;
	transport: string;
	continuation: string | null;
	canonicalHistory: string | null;
	attempts: number;
	retries: number;
	fallbacks: number;
	status: "pending" | "completed" | "failed" | "aborted" | "observed";
	inputTokens: number | null;
	cachedTokens: number | null;
	outputTokens: number | null;
	latencyMs: number | null;
	localId: string | null;
	correlation: "exact" | "legacy";
	kind: "request" | "usage" | "event";
	measurement: "hit" | "miss" | "unknown";
	failureCode: string | null;
	failureCategory: string | null;
	/** Estimated previously cached prefix charged again; null cost means unpriced. */
	rebill?: { tokens: number; cost: number | null };
}

export interface CacheTotals {
	records: number;
	/** Legacy usage and request records cannot be deduplicated; use measuredRequests for hit rate. */
	requestStarts: number;
	measuredRequests: number;
	hits: number;
	misses: number;
	unknownUsage: number;
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	retries: number;
	failures: number;
	fallbacks: number;
	delta: number;
	full: number;
	rebillMisses: number;
	rebillTokens: number;
	rebillCost: number;
	unpricedRebillMisses: number;
	unclassifiedMisses: number;
}

export interface CacheDay extends CacheTotals {
	day: string;
}

export interface CacheQuery {
	session?: string;
	project?: string;
	since?: string;
	until?: string;
	model?: string;
	lane?: string;
	scope?: string;
	/** Filters request rows only, never totals or days. */
	result?: "hit" | "miss" | "unknown" | "";
	offset?: number;
}

export interface CacheQueryResult {
	version: 1;
	totals: CacheTotals;
	days: CacheDay[];
	requests: CacheRequest[];
	total: number;
	offset: number;
	limit: 50;
}

export interface CacheSnapshot {
	version: 2;
	revision: number;
	coverage: {
		directory: string;
		directoryAvailable: boolean;
		files: number;
		indexedFiles: number;
		pendingBytes: number;
		partialFiles: number;
		malformed: number;
		invalidUsage: number;
		rewrittenFiles: number;
		missingFiles: number;
		unreadableFiles: number;
		fromDay: string | null;
		toDay: string | null;
		legacyRecords: number;
		rebillPendingFiles: number;
	};
	models: string[];
	scopes?: string[];
}
