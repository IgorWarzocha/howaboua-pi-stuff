import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeCompactResult } from "@earendil-works/pi-coding-agent";

const PREPARATION_CHANNEL = "pi-codex-conversion:compaction-preparation:v1";
type Preparation = (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => SessionBeforeCompactResult | void | Promise<SessionBeforeCompactResult | void>;
interface PreparationRequest {
	protocol: 1;
	add(prepare: Preparation): void;
}

/**
 * Pi's compaction hooks are ordered, not a prepare/execute pair. Register the same
 * memoized preparation with Pi and PCC so policy and edits precede provider work
 * in either extension order. The event remains Pi's ordinary compaction event.
 */
export function registerCompactionPreparation(pi: ExtensionAPI, handler: Preparation): { prepare: Preparation; dispose(): void } {
	const results = new WeakMap<SessionBeforeCompactEvent, Promise<SessionBeforeCompactResult | void>>();
	const prepare: Preparation = (event, ctx) => {
		let pending = results.get(event);
		if (!pending) {
			pending = Promise.resolve().then(() => handler(event, ctx));
			results.set(event, pending);
		}
		return pending;
	};
	const dispose = pi.events.on(PREPARATION_CHANNEL, value => {
		const request = value as Partial<PreparationRequest> | undefined;
		if (request?.protocol === 1 && typeof request.add === "function") request.add(prepare);
	});
	return { prepare, dispose };
}

export async function prepareExtensionCompaction(pi: ExtensionAPI, event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<SessionBeforeCompactResult | undefined> {
	const preparations: Preparation[] = [];
	pi.events.emit(PREPARATION_CHANNEL, { protocol: 1, add: (prepare: Preparation) => preparations.push(prepare) } satisfies PreparationRequest);
	let result: SessionBeforeCompactResult | undefined;
	for (const prepare of preparations) {
		const prepared = await prepare(event, ctx);
		if (prepared) result = prepared;
		if (result?.cancel) return result;
	}
	return result;
}
