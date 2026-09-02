import type { Component } from "@earendil-works/pi-tui";
import type { RuntimeToolTrace } from "./types.js";

const MAX_NESTED_RENDER_STATES = 512;
const MAX_NESTED_RENDER_BYTES = 32 * 1024 * 1024;
const MAX_ESTIMATE_NODES = 4_096;

export interface NestedRenderState {
	state: Record<string, unknown>;
	callComponent?: Component | undefined;
	resultComponent?: Component | undefined;
	input?: unknown;
	result?: RuntimeToolTrace["result"];
}

export class CodeModeNestedRenderStore {
	private readonly states = new Map<string, NestedRenderState>();
	private readonly weights = new Map<string, number>();
	private retainedBytes = 0;
	private readonly maxBytes: number;

	constructor(maxBytes = MAX_NESTED_RENDER_BYTES) {
		this.maxBytes = Math.max(0, maxBytes);
	}

	get(traceId: string): NestedRenderState {
		const existing = this.states.get(traceId);
		if (existing) {
			this.states.delete(traceId);
			this.states.set(traceId, existing);
			return existing;
		}
		const created = { state: {} };
		this.states.set(traceId, created);
		this.weights.set(traceId, 0);
		this.trim();
		return created;
	}

	captureInput(traceId: string, input: unknown): void {
		const state = this.get(traceId);
		state.input = input;
		this.rebalance(traceId);
	}

	captureResult(
		traceId: string,
		result: NonNullable<RuntimeToolTrace["result"]>,
	): void {
		const state = this.get(traceId);
		state.result = result;
		this.rebalance(traceId);
	}

	rebalance(traceId: string): void {
		const state = this.states.get(traceId);
		if (!state) return;
		const previous = this.weights.get(traceId) ?? 0;
		const next = retainedPayloadBytes(state, this.maxBytes + 1);
		this.weights.set(traceId, next);
		this.retainedBytes += next - previous;
		this.trim();
	}

	clear(): void {
		this.states.clear();
		this.weights.clear();
		this.retainedBytes = 0;
	}

	private delete(traceId: string): void {
		if (!this.states.delete(traceId)) return;
		this.retainedBytes -= this.weights.get(traceId) ?? 0;
		this.weights.delete(traceId);
	}

	private trim(): void {
		while (
			this.states.size > MAX_NESTED_RENDER_STATES ||
			this.retainedBytes > this.maxBytes
		) {
			const oldest = this.states.keys().next().value;
			if (oldest === undefined) return;
			this.delete(oldest);
		}
	}
}

function retainedPayloadBytes(
	state: NestedRenderState,
	limit: number,
): number {
	const budget = {
		remaining: limit,
		nodes: MAX_ESTIMATE_NODES,
		seen: new WeakSet<object>(),
	};
	let bytes = retainedValueBytes(state.input, budget);
	bytes += retainedValueBytes(state.result, budget);
	bytes += retainedValueBytes(state.state, budget);
	return Math.min(limit, bytes);
}

interface RetainedByteBudget {
	remaining: number;
	nodes: number;
	seen: WeakSet<object>;
}

function retainedValueBytes(
	value: unknown,
	budget: RetainedByteBudget,
): number {
	if (budget.remaining <= 0) return 0;
	if (budget.nodes <= 0) {
		const bytes = budget.remaining;
		budget.remaining = 0;
		return bytes;
	}
	if (value === null || value === undefined) return 0;
	if (typeof value === "string") {
		const bytes = Math.min(budget.remaining, Buffer.byteLength(value));
		budget.remaining -= bytes;
		return bytes;
	}
	if (
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "bigint"
	) {
		const bytes = Math.min(budget.remaining, 8);
		budget.remaining -= bytes;
		return bytes;
	}
	if (typeof value !== "object") return 0;
	if (budget.seen.has(value)) return 0;
	budget.seen.add(value);
	budget.nodes--;
	let bytes = 0;
	let entries: Array<[string, unknown]>;
	try {
		entries = Object.entries(value);
	} catch {
		const uninspectable = budget.remaining;
		budget.remaining = 0;
		return uninspectable;
	}
	for (const [key, item] of entries) {
		bytes += retainedValueBytes(key, budget);
		bytes += retainedValueBytes(item, budget);
		if (budget.remaining <= 0 || budget.nodes <= 0) break;
	}
	return bytes;
}
