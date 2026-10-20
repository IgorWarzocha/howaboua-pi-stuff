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
}

export interface CacheBucket {
	day: string;
	sessionId: string | null;
	sessionName: string | null;
	project: string | null;
	model: string;
	lane: string;
	scope: string;
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
}

export interface CacheSnapshot {
	version: 1;
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
		historyTruncated: boolean;
		requestsTruncated: boolean;
		legacyRecords: number;
	};
	buckets: CacheBucket[];
	requests: CacheRequest[];
}
