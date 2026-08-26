import type { Component } from "@earendil-works/pi-tui";
import type { RuntimeToolTrace } from "./types.js";

const MAX_NESTED_RENDER_STATES = 512;

export interface NestedRenderState {
	state: Record<string, unknown>;
	callComponent?: Component | undefined;
	resultComponent?: Component | undefined;
	input?: unknown;
	result?: RuntimeToolTrace["result"];
}

export class CodeModeNestedRenderStore {
	private readonly states = new Map<string, NestedRenderState>();

	get(traceId: string): NestedRenderState {
		const existing = this.states.get(traceId);
		if (existing) {
			this.states.delete(traceId);
			this.states.set(traceId, existing);
			return existing;
		}
		const created = { state: {} };
		this.states.set(traceId, created);
		if (this.states.size > MAX_NESTED_RENDER_STATES) {
			const oldest = this.states.keys().next().value;
			if (oldest !== undefined) this.states.delete(oldest);
		}
		return created;
	}

	captureInput(traceId: string, input: unknown): void {
		this.get(traceId).input = input;
	}

	captureResult(
		traceId: string,
		result: NonNullable<RuntimeToolTrace["result"]>,
	): void {
		this.get(traceId).result = result;
	}
}
