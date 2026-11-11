import { type Stats, statSync } from "node:fs";
import {
	buildContextEntries,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	deliveryId,
	opaqueState,
	pendingId,
	pruneContent,
	snapshotKey,
} from "./session-pruning-content.js";
import type { SessionPruningPolicy } from "./session-pruning-policy.js";
import { scanSession } from "./session-pruning-source.js";
import { projectTreeCheckpointBranch } from "./tree-checkpoint.js";
import { windowDetails } from "./windows.js";

interface RecordIndex {
	id: string;
	parent: string | null;
	window: string | undefined;
	state: string | undefined;
	calls: string[];
	result: string | undefined;
}
export interface PruningPlan {
	path: string;
	sessionId: string;
	policy: SessionPruningPolicy;
	now: number;
	source: Stats;
	protectedIds: Set<string>;
	fullIds: Set<string>;
	stateIds: Set<string>;
	delivered: Set<string>;
	ids: Set<string>;
	before: number;
	after: number;
	changed: number;
	opaque: string[];
}

/** An active legacy checkpoint can live outside Pi's physical branch. */
export function pruningContext(manager: ExtensionContext["sessionManager"]) {
	const branch = manager.getBranch();
	const projected = projectTreeCheckpointBranch(branch, manager.getEntries());
	const protectedIds = new Set(
		manager.buildContextEntries().map((entry) => entry.id),
	);
	if (projected !== branch)
		for (const entry of buildContextEntries([...projected]))
			protectedIds.add(entry.id);
	return { branch: projected, protectedIds };
}

export async function planSessionPruning(
	manager: ExtensionContext["sessionManager"],
	policy: SessionPruningPolicy,
	now = Date.now(),
): Promise<PruningPlan> {
	const path = manager.getSessionFile();
	if (!path) throw new Error("Session has not been saved yet.");
	const source = statSync(path);
	const { branch, protectedIds } = pruningContext(manager);
	const windows = [
		...new Set(
			branch.flatMap((entry) => {
				const details = windowDetails(entry);
				return details?.kind === "window"
					? [details.identity.currentWindowId]
					: [];
			}),
		),
	];
	const current = windows.at(-1);
	const retained = new Set(
		policy.windows ? windows.slice(-policy.windows) : [],
	);
	const index = new Map<string, RecordIndex>();
	const delivered = new Set<string>();
	const opaque = new Set<string>();
	let header = false;
	await scanSession(path, source.size, (entry) => {
		if (entry.type === "session") {
			if (header || entry.id !== manager.getSessionId() || entry.version !== 3)
				throw new Error(
					"Session identity or format changed. Resume it before pruning.",
				);
			header = true;
			return;
		}
		if (!header || index.has(entry.id))
			throw new Error("Session has duplicate or misplaced records.");
		const details = windowDetails(entry);
		index.set(entry.id, {
			id: entry.id,
			parent: entry.parentId,
			window:
				details?.kind === "window"
					? details.identity.currentWindowId
					: undefined,
			state: snapshotKey(entry),
			calls:
				entry.type === "message" && entry.message.role === "assistant"
					? entry.message.content.flatMap((part) =>
							part.type === "toolCall" ? [part.id] : [],
						)
					: [],
			result:
				entry.type === "message" && entry.message.role === "toolResult"
					? entry.message.toolCallId
					: undefined,
		});
		if (entry.type === "custom_message") {
			const id = deliveryId(entry);
			if (id) delivered.add(id);
			if (
				entry.details &&
				typeof entry.details === "object" &&
				"herdrAdmissionId" in entry.details &&
				typeof entry.details.herdrAdmissionId === "string"
			)
				delivered.add(entry.details.herdrAdmissionId);
		}
		const unknown = opaqueState(entry);
		if (unknown) opaque.add(unknown);
		// Validate known pending state even when protected.
		pendingId(entry);
	});
	const parents = new Set<string>();
	for (const node of index.values()) {
		if (node.parent !== null && !index.has(node.parent))
			throw new Error("Session has a broken parent chain.");
		if (node.parent) parents.add(node.parent);
	}
	const stateIds = new Set<string>();
	for (const leaf of index.values()) {
		if (parents.has(leaf.id)) continue;
		const seen = new Set<string>();
		const visited = new Set<string>();
		let node: RecordIndex | undefined = leaf;
		while (node) {
			if (visited.has(node.id))
				throw new Error("Session contains a parent cycle.");
			visited.add(node.id);
			if (node.state && !seen.has(node.state)) {
				stateIds.add(node.id);
				seen.add(node.state);
			}
			node = node.parent ? index.get(node.parent) : undefined;
		}
	}
	const fullIds = new Set<string>();
	for (const node of index.values()) {
		if (node.window === undefined) {
			const path: RecordIndex[] = [];
			const visited = new Set<string>();
			let ancestor: RecordIndex | undefined = node;
			while (ancestor && ancestor.window === undefined) {
				if (visited.has(ancestor.id))
					throw new Error("Session contains a parent cycle.");
				visited.add(ancestor.id);
				path.push(ancestor);
				ancestor = ancestor.parent ? index.get(ancestor.parent) : undefined;
			}
			for (const item of path) item.window = ancestor?.window ?? "";
		}
		if (current && node.window === current) protectedIds.add(node.id);
		if (
			!policy.windows ||
			(node.window && retained.has(node.window)) ||
			protectedIds.has(node.id)
		)
			fullIds.add(node.id);
	}
	// A retained result/call keeps its counterpart, including pairs crossing a window cut.
	const calls = new Map<string, string[]>();
	const results = new Map<string, string[]>();
	for (const node of index.values()) {
		for (const call of node.calls)
			calls.set(call, [...(calls.get(call) ?? []), node.id]);
		if (node.result)
			results.set(node.result, [...(results.get(node.result) ?? []), node.id]);
	}
	const queue = [...fullIds];
	const keep = (id: string) => {
		if (!fullIds.has(id)) {
			fullIds.add(id);
			queue.push(id);
		}
	};
	for (let offset = 0; offset < queue.length; offset++) {
		const id = queue[offset];
		const node = id === undefined ? undefined : index.get(id);
		if (!node) continue;
		if (node.result) {
			for (const call of calls.get(node.result) ?? []) keep(call);
		}
		for (const call of node.calls)
			for (const result of results.get(call) ?? []) keep(result);
	}
	const plan: PruningPlan = {
		path,
		sessionId: manager.getSessionId(),
		policy,
		now,
		source,
		protectedIds,
		fullIds,
		stateIds,
		delivered,
		ids: new Set(index.keys()),
		before: source.size,
		after: 0,
		changed: 0,
		opaque: [...opaque].sort(),
	};
	await scanSession(path, source.size, (entry, raw) => {
		const rewritten =
			entry.type === "session" ? entry : transformPruningEntry(plan, entry);
		const text = rewritten === entry ? raw : JSON.stringify(rewritten);
		plan.after += Buffer.byteLength(text) + 1;
		if (text !== raw) plan.changed++;
	});
	return plan;
}

export function transformPruningEntry(
	plan: PruningPlan,
	entry: Parameters<typeof pruneContent>[0],
) {
	if (plan.protectedIds.has(entry.id)) return entry;
	const expire =
		plan.policy.days > 0 &&
		Date.parse(entry.timestamp) < plan.now - plan.policy.days * 86_400_000;
	return pruneContent(
		entry,
		plan.fullIds.has(entry.id),
		expire,
		plan.stateIds.has(entry.id),
		plan.delivered,
	);
}
