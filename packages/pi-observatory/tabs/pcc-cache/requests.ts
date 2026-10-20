import type { CacheRequest } from "./contracts.ts";
import { counter, type LogEvent, label } from "./parser.ts";
import type { RebillEvidence } from "./rebill.ts";

export interface Header {
	epoch: number;
	sessionId: string | null;
	sessionName: string | null;
	project: string | null;
}
export interface RequestRecord {
	row: CacheRequest;
	requestSeen: boolean;
	successful: boolean;
	rebillEvidence?: RebillEvidence;
	rebillUnclassified?: boolean;
}

export function newRecord(
	id: string,
	event: LogEvent,
	header: Header,
): RequestRecord {
	const localId = label(event, "local_request_id");
	return {
		requestSeen: false,
		successful: false,
		row: {
			id,
			time: event.time,
			sessionId: header.sessionId,
			sessionName: header.sessionName,
			project: header.project,
			model: "Unknown",
			lane:
				label(event, "lane") ??
				(label(event, "event") === "prewarm-ready" ? "prewarm" : "Unknown"),
			scope: label(event, "scope") ?? "Unknown",
			transport: label(event, "transport") ?? "Unknown",
			continuation: null,
			canonicalHistory: null,
			attempts: 0,
			retries: 0,
			fallbacks: 0,
			status: "observed",
			inputTokens: null,
			cachedTokens: null,
			outputTokens: null,
			latencyMs: null,
			localId,
			correlation: localId ? "exact" : "legacy",
			kind: "event",
			measurement: "unknown",
			failureCode: null,
			failureCategory: null,
		},
	};
}

/** Returns whether an authoritative usage event contained invalid/missing counters. */
export function applyEvent(record: RequestRecord, event: LogEvent): boolean {
	const row = record.row;
	const type = label(event, "event");
	row.transport =
		label(event, "transport") ??
		(type === "fallback" ? label(event, "to") : null) ??
		row.transport;
	if (type === "request") {
		record.requestSeen = true;
		row.kind = "request";
		row.model = label(event, "model") ?? row.model;
		row.attempts = Math.max(row.attempts, counter(event, "attempt") ?? 1);
		row.continuation = label(event, "continuation");
		row.canonicalHistory = label(event, "canonical_history");
		if (!record.successful) row.status = "pending";
	}
	if (type === "retry") row.retries++;
	if (type === "fallback") row.fallbacks++;
	if (type === "failure" || type === "retry") {
		row.failureCategory = label(event, "failure");
		row.failureCode = label(event, "code");
		if (type === "failure" && !record.successful)
			row.status = row.failureCategory === "aborted" ? "aborted" : "failed";
	}
	if (type === "timing") {
		const elapsed = event.fields["request_elapsed_ms"];
		if (typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0)
			row.latencyMs = elapsed;
		row.attempts = Math.max(row.attempts, counter(event, "attempt") ?? 0);
		if (label(event, "outcome") === "aborted" && !record.successful)
			row.status = "aborted";
	}
	if (type !== "usage" && type !== "prewarm-ready") return false;
	record.successful = true;
	row.status = "completed";
	if (!record.requestSeen) row.kind = "usage";
	if (
		type === "prewarm-ready" &&
		label(event, "cache_usage") !== "authoritative"
	)
		return false;
	// The logger has already included cache reads and writes in this input total.
	const input = counter(event, "input_tokens");
	const cached = counter(event, "cache_read");
	const written =
		event.fields["cache_write"] === undefined
			? 0
			: counter(event, "cache_write");
	const output = counter(event, "output_tokens");
	const valid =
		input !== null &&
		cached !== null &&
		written !== null &&
		cached + written <= input;
	row.outputTokens = output;
	if (valid) {
		row.inputTokens = input;
		row.cachedTokens = cached;
		row.measurement = input > 0 ? (cached > 0 ? "hit" : "miss") : "unknown";
	}
	return (
		!valid || (event.fields["output_tokens"] !== undefined && output === null)
	);
}
