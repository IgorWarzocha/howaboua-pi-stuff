import type { FileCursor } from "./index-store.ts";
import { counter, type LogEvent, label } from "./parser.ts";
import type { RequestRecord } from "./requests.ts";

export const REBILL_VERSION = 2;

interface WarmContext {
	signature: string | null;
	generation: number;
	cached: number;
}
export interface RebillState {
	epoch: number;
	sessionId: string | null;
	processId: string | null;
	generation: number;
	contexts: Record<string, WarmContext>;
}
export interface RebillEvidence {
	context: string;
	signature: string | null;
	epoch: number;
	generation: number;
	tier: string | null;
	model: string | null;
}

const FINGERPRINTS = [
	"instructions_fingerprint",
	"tools_fingerprint",
	"cache_key_fingerprint",
	"routing_fingerprint",
	"options_fingerprint",
] as const;

// Verified 2026-10-20: https://developers.openai.com/api/docs/pricing.md
// USD per million input/cached tokens. Deliberately exact IDs, not model-family guesses.
const RATES: Record<string, { input: number; cached: number }> = {
	"gpt-6-astra": { input: 10, cached: 1 },
	"gpt-6.1-sol": { input: 2, cached: 0.1 },
	"gpt-6-sol": { input: 2, cached: 0.2 },
	"gpt-6-luna": { input: 0.1, cached: 0.01 },
	"gpt-5.6-sol": { input: 4, cached: 0.4 },
	"gpt-5.6-terra": { input: 2, cached: 0.2 },
	"gpt-5.6-luna": { input: 0.2, cached: 0.02 },
};

function estimateCost(
	evidence: RebillEvidence,
	event: LogEvent,
	tokens: number,
	input: number,
): number | null {
	const rates =
		evidence.model && Object.hasOwn(RATES, evidence.model)
			? RATES[evidence.model]
			: undefined;
	// Cache-write retention and its charge are not recorded. Never price them as normal input.
	if (!rates || counter(event, "cache_write") !== 0) return null;
	let multiplier: number;
	switch (evidence.tier) {
		case "unset":
		case "default":
			multiplier = 1;
			break;
		case "priority":
		case "fast":
			multiplier = 2;
			break;
		case "flex":
		case "batch":
			multiplier = 0.5;
			break;
		case "ultrafast":
			if (evidence.model !== "gpt-6-astra" && evidence.model !== "gpt-6.1-sol")
				return null;
			multiplier = 6;
			break;
		default:
			return null;
	}
	return (
		(tokens *
			(rates.input - rates.cached) *
			multiplier *
			(input > 272_000 ? 2 : 1)) /
		1_000_000
	);
}

function requestSignature(event: LogEvent, cursor: FileCursor): string | null {
	const model = label(event, "model");
	const fingerprints = FINGERPRINTS.map((key) => label(event, key));
	if (
		!cursor.header.sessionId ||
		!label(event, "local_request_id") ||
		!label(event, "lane") ||
		!model ||
		model === "Unknown" ||
		fingerprints.some((value) => !value || !/^[a-f0-9]{64}$/.test(value))
	)
		return null;
	return JSON.stringify([model, ...fingerprints]);
}

/** Replay every event, including unmeasured failed requests, before any query filters. */
export function replayRebill(
	record: RequestRecord,
	event: LogEvent,
	cursor: FileCursor,
): void {
	let state = cursor.rebill;
	if (
		!state ||
		state.epoch !== cursor.header.epoch ||
		state.sessionId !== cursor.header.sessionId
	) {
		state = {
			epoch: cursor.header.epoch,
			sessionId: cursor.header.sessionId,
			processId: null,
			generation: 0,
			contexts: {},
		};
		cursor.rebill = state;
	}
	const type = label(event, "event");
	const contextKey = JSON.stringify([
		label(event, "scope"),
		label(event, "lane"),
	]);
	if (type === "request") {
		const processId = label(event, "request_counter_process_id");
		const compactionSource = label(event, "compaction_source");
		if (
			(processId && state.processId && processId !== state.processId) ||
			label(event, "lane") === "compaction" ||
			label(event, "scope") === "compaction" ||
			label(event, "canonical_history") === "compaction" ||
			compactionSource === "canonical" ||
			compactionSource === "reconstructed"
		) {
			state.contexts = {};
		}
		if (processId) state.processId = processId;
		const signature = requestSignature(event, cursor);
		let context = state.contexts[contextKey];
		if (!context || context.signature !== signature || !signature) {
			context = { signature, generation: ++state.generation, cached: 0 };
			state.contexts[contextKey] = context;
		}
		record.rebillEvidence = {
			context: contextKey,
			signature,
			epoch: state.epoch,
			generation: context.generation,
			tier: label(event, "service_tier"),
			model: label(event, "model"),
		};
		delete record.row.rebill;
		delete record.rebillUnclassified;
		return;
	}
	if (
		type !== "usage" &&
		!(
			type === "prewarm-ready" &&
			label(event, "cache_usage") === "authoritative"
		)
	)
		return;
	delete record.row.rebill;
	delete record.rebillUnclassified;
	const input = counter(event, "input_tokens");
	const cached = counter(event, "cache_read");
	const written =
		event.fields["cache_write"] === undefined
			? 0
			: counter(event, "cache_write");
	if (
		input === null ||
		cached === null ||
		written === null ||
		cached + written > input ||
		input === 0
	)
		return;
	const evidence = record.rebillEvidence;
	const context = evidence ? state.contexts[evidence.context] : undefined;
	if (
		!evidence?.signature ||
		evidence.epoch !== state.epoch ||
		!context ||
		context.generation !== evidence.generation
	) {
		if (cached === 0) record.rebillUnclassified = true;
		return;
	}
	// A shortened context is a cold boundary, not evidence that the old prefix was rebilled.
	if (input < context.cached) context.cached = 0;
	if (cached > 0) {
		context.cached = cached;
	} else if (context.cached > 0) {
		const tokens = Math.min(context.cached, input);
		record.row.rebill = {
			tokens,
			cost: estimateCost(evidence, event, tokens, input),
		};
		// Retain the last positive read across consecutive zero-read requests.
	}
}
