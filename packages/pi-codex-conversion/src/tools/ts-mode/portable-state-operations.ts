import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import type { PortableState, PortableValue } from "./portable-state.ts";

/** Profiles are loaded by value: their graph IDs must not alias an existing session graph. */
export function forkPortableState(original: PortableState): PortableState {
	return remapPortableState(original, () => randomUUID());
}

export function remapPortableState(original: PortableState, identity: (index: number) => string): PortableState {
	const state: PortableState = deserialize(serialize(original));
	const ids = new Map(Object.keys(state.nodes).map((id, index) => [id, identity(index)]));
	const remap = (value: PortableValue): PortableValue => value !== null && typeof value === "object" ? { ref: ids.get(value.ref) ?? value.ref } : value;
	const properties = (values: Record<string, PortableValue>): Record<string, PortableValue> => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, remap(value)]));
	state.roots = properties(state.roots);
	state.nodes = Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => {
		switch (node.kind) {
			case "object": case "array": case "recipe": node.properties = properties(node.properties); break;
			case "map": node.entries = node.entries.map(([key, value]) => [remap(key), remap(value)]); break;
			case "set": node.entries = node.entries.map(remap); break;
			case "view": node.buffer = remap(node.buffer); break;
			case "checkpoint": node.data = remap(node.data); break;
		}
		return [ids.get(id) ?? id, node];
	}));
	return state;
}

/** Roots containing checkpoint identities must be initialised after reconstruction. */
export function checkpointRoots(state: PortableState): string[] {
	return Object.keys(state.roots).filter(name => {
		const visited = new Set<string>();
		const contains = (value: PortableValue): boolean => {
			if (value === null || typeof value !== "object" || visited.has(value.ref)) return false;
			visited.add(value.ref);
			const node = state.nodes[value.ref];
			if (node?.kind === "checkpoint") return true;
			if (node?.kind === "object" || node?.kind === "array" || node?.kind === "recipe") return Object.values(node.properties).some(contains);
			if (node?.kind === "map") return node.entries.some(([key, item]) => contains(key) || contains(item));
			if (node?.kind === "set") return node.entries.some(contains);
			if (node?.kind === "view") return contains(node.buffer);
			return false;
		};
		return contains(state.roots[name]);
	});
}

function same(left: unknown, right: unknown): boolean { return serialize(left).equals(serialize(right)); }

/** Three-way merge is synchronous; the client persists before publishing this candidate. */
export function mergeState(start: PortableState, current: PortableState, candidate: PortableState): { state: PortableState; conflicts: string[] } {
	const state: PortableState = deserialize(serialize(current));
	const conflicts: string[] = [];
	for (const field of ["roots", "nodes", "bindings"] as const) {
		const before: Record<string, unknown> = start[field];
		const latest: Record<string, unknown> = current[field];
		const proposed: Record<string, unknown> = candidate[field];
		const merged: Record<string, unknown> = state[field];
		for (const key of new Set([...Object.keys(before), ...Object.keys(proposed)])) {
			// A worker's unreachable node may still be retained by another cell's new alias.
			// Only compact the complete merged graph, never delete nodes from a partial snapshot.
			if (field === "nodes" && !Object.hasOwn(proposed, key)) continue;
			if (field === "nodes" && !Object.hasOwn(latest, key)) {
				Object.defineProperty(merged, key, { value: proposed[key], enumerable: true, writable: true, configurable: true });
				continue;
			}
			if (Object.hasOwn(before, key) === Object.hasOwn(proposed, key) && same(before[key], proposed[key])) continue;
			if (Object.hasOwn(before, key) !== Object.hasOwn(latest, key) || !same(before[key], latest[key])) { conflicts.push(field === "nodes" ? `shared data (${ownersOfNode(current, key).join(", ") || "retained value"})` : `binding ${key}`); continue; }
			if (Object.hasOwn(proposed, key)) Object.defineProperty(merged, key, { value: proposed[key], enumerable: true, writable: true, configurable: true });
			else delete merged[key];
		}
	}
	state.pins = [...new Set([...current.pins.filter(name => !start.pins.includes(name) || candidate.pins.includes(name)), ...candidate.pins.filter(name => !start.pins.includes(name))])];
	state.imports = [...new Set([...current.imports, ...candidate.imports])];
	return { state, conflicts };
}

export function ownersOfNode(state: PortableState, target: string): string[] {
	return Object.entries(state.roots).filter(([, root]) => {
		const seen = new Set<string>();
		const contains = (value: PortableValue): boolean => {
			if (value === null || typeof value !== "object" || seen.has(value.ref)) return false;
			if (value.ref === target) return true;
			seen.add(value.ref);
			const node = state.nodes[value.ref];
			if (node?.kind === "object" || node?.kind === "array" || node?.kind === "recipe") return Object.values(node.properties).some(contains);
			if (node?.kind === "map") return node.entries.some(([key, item]) => contains(key) || contains(item));
			if (node?.kind === "set") return node.entries.some(contains);
			if (node?.kind === "view") return contains(node.buffer);
			if (node?.kind === "checkpoint") return contains(node.data);
			return false;
		};
		return contains(root);
	}).map(([name]) => name);
}

export function compactState(state: PortableState): PortableState {
	const reachable = new Set<string>();
	const visit = (value: PortableValue): void => {
		if (value === null || typeof value !== "object" || reachable.has(value.ref)) return;
		reachable.add(value.ref);
		const node = state.nodes[value.ref];
		if (!node) throw new Error(`Missing portable object ${value.ref}`);
		if (node.kind === "object" || node.kind === "array" || node.kind === "recipe") Object.values(node.properties).forEach(visit);
		else if (node.kind === "map") node.entries.forEach(([key, item]) => { visit(key); visit(item); });
		else if (node.kind === "set") node.entries.forEach(visit);
		else if (node.kind === "view") visit(node.buffer);
		else if (node.kind === "checkpoint") visit(node.data);
	};
	Object.values(state.roots).forEach(visit);
	state.nodes = Object.fromEntries(Object.entries(state.nodes).filter(([id]) => reachable.has(id)));
	return state;
}
