import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeCompactResult, SessionEntry } from "@earendil-works/pi-coding-agent";

const WINDOW_PREPARATION_CHANNEL = "pi-codex-conversion:context-window-preparation:v1";
type WindowPreparation = (ctx: ExtensionContext) => void | Promise<void>;
interface WindowPreparationRequest {
	protocol: 1;
	add(prepare: WindowPreparation): void;
}

/** Await consumers of the outgoing context before retiring it without compaction. */
export function registerContextWindowPreparation(pi: ExtensionAPI, prepare: WindowPreparation): () => void {
	return pi.events.on(WINDOW_PREPARATION_CHANNEL, value => {
		const request = value as Partial<WindowPreparationRequest> | undefined;
		if (request?.protocol === 1 && typeof request.add === "function") request.add(prepare);
	});
}

export async function prepareContextWindow(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const preparations: WindowPreparation[] = [];
	pi.events.emit(WINDOW_PREPARATION_CHANNEL, { protocol: 1, add: (prepare: WindowPreparation) => preparations.push(prepare) } satisfies WindowPreparationRequest);
	// Execute outside Pi's notification bus so completion and failures reach the owner.
	for (const prepare of preparations) await prepare(ctx);
}

const PROJECTION_CHANNEL = "pi-codex-conversion:context-branch-projection:v1";
type BranchProjection = (entries: readonly SessionEntry[], ctx: ExtensionContext) => readonly SessionEntry[];
interface ProjectionRequest {
	protocol: 1;
	add(project: BranchProjection): void;
}

/** Read-only context reconstruction for isolated consumers outside Pi's context hook. */
export function registerContextBranchProjection(pi: ExtensionAPI, project: BranchProjection): () => void {
	return pi.events.on(PROJECTION_CHANNEL, value => {
		const request = value as Partial<ProjectionRequest> | undefined;
		if (request?.protocol === 1 && typeof request.add === "function") request.add(project);
	});
}

export function projectContextBranch(pi: ExtensionAPI, ctx: ExtensionContext, entries: readonly SessionEntry[]): readonly SessionEntry[] {
	const projections: BranchProjection[] = [];
	pi.events.emit(PROJECTION_CHANNEL, { protocol: 1, add: (project: BranchProjection) => projections.push(project) } satisfies ProjectionRequest);
	// Pi's event bus logs handler exceptions; execute outside it so failures propagate.
	for (const project of projections) entries = project(entries, ctx);
	return entries;
}

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
