import { deserialize, serialize } from "node:v8";
import type { NotebookControlRequest, NotebookControlResult } from "../code-mode/types.ts";
import { globMatcher } from "../notebook-mode/glob.ts";
import { compactState, emptyState, type PortableState } from "./portable-state.ts";
import type { TsStateStorage } from "./state-storage.ts";

export interface TsLifecycleHost {
	state(): PortableState;
	storage(): TsStateStorage;
	activeCells(): string[];
	commit(state: PortableState): Promise<string | undefined>;
	syncProject(): Promise<string | undefined>;
	restart(): Promise<void>;
	reset(): Promise<void>;
}

export class TsStateLifecycle {
	private readonly host: TsLifecycleHost;
	constructor(host: TsLifecycleHost) { this.host = host; }

	async control(request: NotebookControlRequest): Promise<NotebookControlResult> {
		const state = this.host.state();
		const storage = this.host.storage();
		if (request.action === "status" || request.action === "diagnostics") return this.status(request);
		if (request.action === "list") {
			const saved = await storage.list();
			const matches = request.query ? globMatcher(request.query) : () => true;
			const profiles = saved.profiles.filter(matches);
			const candidates = saved.candidates.filter(matches);
			return { message: `TS profiles: ${profiles.join(", ") || "none"}\nRecovery candidates in this session: ${candidates.join(", ") || "none"}`, details: { profiles, candidates } };
		}
		if (request.action === "save") {
			await storage.writeProfile(request.name, state);
			return { message: `TS profile ${request.name} saved from committed state`, details: {} };
		}
		if (request.action === "checkpoint") {
			await storage.write(state);
			const notice = await this.host.syncProject();
			return { message: `TS committed state saved${notice ? `\n${notice}` : ""}`, details: {} };
		}
		if (this.host.activeCells().length) throw new Error("TS lifecycle changes require idle state; wait for or terminate active cells first. Status and save read committed state.");
		let next: PortableState = deserialize(serialize(state));
		switch (request.action) {
			case "load": next = request.name.startsWith("candidate-") ? await storage.read(request.name) : await storage.readProfile(request.name); break;
			case "reset": await this.host.reset(); return { message: "TS session reset to committed project pins; saved profiles are unchanged", details: {} };
			case "restart": await this.host.restart(); return { message: "TS restarted from its unchanged committed baseline", details: {} };
			case "pin":
				if (request.hook) throw new Error("TS lifecycle hooks are unavailable; call the retained function explicitly. Code and Deno Notebook remain available.");
				for (const name of request.names) {
					if (!Object.hasOwn(next.bindings, name)) throw new Error(`No committed TS binding ${name}`);
					if (!next.pins.includes(name)) next.pins.push(name);
				}
				break;
			case "unpin": next.pins = next.pins.filter(name => !request.names.includes(name)); break;
			case "release": case "prune": {
				const matches = request.action === "release" ? (name: string) => request.names.includes(name) : globMatcher(request.query);
				const removed = new Set(Object.keys(next.bindings).filter(name => matches(name) && !next.pins.includes(name)));
				for (const name of removed) { delete next.bindings[name]; delete next.roots[name]; }
				compactState(next);
				for (const binding of Object.values(next.bindings)) {
					const dependency = binding.references?.find(name => removed.has(name));
					if (dependency) throw new Error(`Cannot release ${dependency}: retained function ${binding.name} needs it. Release both together or redefine the helper first.`);
				}
				for (const node of Object.values(next.nodes)) if (node.kind === "recipe" && removed.has(node.name)) throw new Error(`Cannot release ${node.name}: a retained alias needs its function recipe. Release the alias too.`);
				break;
			}
		}
		const notice = await this.host.commit(next);
		return { message: `TS ${request.action} complete${notice ? `\n${notice}` : ""}`, details: { retainedBindings: Object.keys(next.bindings).length, pinnedBindings: next.pins.length } };
	}

	private status(request: Extract<NotebookControlRequest, { action: "status" | "diagnostics" }>): NotebookControlResult {
		const state = this.host.state();
		const query = "query" in request ? request.query : undefined;
		const bindings = Object.values(state.bindings).filter(binding => !query || globMatcher(query)(binding.name)).map(binding => ({ name: binding.name, kind: binding.kind, declaration: binding.declaration, pinned: state.pins.includes(binding.name) }));
		const imports = state.imports.filter(specifier => specifier.startsWith("npm:"));
		const startupStatus = `TS state: ${Object.keys(state.bindings).length} bindings, ${state.pins.length} pinned${bindings.length ? `\n${bindings.map(binding => `${binding.name}: ${binding.kind}${binding.pinned ? " [pinned]" : ""}`).join("\n")}` : ""}\nAvailable npm imports in TS: ${imports.length ? imports.join(", ") : "none"}. Ask before adding another, then use an exact-version npm: specifier`;
		return { message: `${startupStatus}${query ? `\n${bindings.map(binding => binding.declaration).join("\n")}` : ""}\n${this.host.activeCells().length}/4 active cells. Plain data, top-level functions and import recipes transfer; captured closures/live handles do not. Tool and file effects are not rolled back.`,
			details: { mode: "ts", startupStatus, bindings, retainedBindings: Object.keys(state.bindings).length, pinnedBindings: state.pins.length, activeCells: this.host.activeCells(), imports, ...(request.action === "diagnostics" ? { storage: this.host.storage().directory } : {}) } };
	}
}

/** Enums have both value and type authority; retain them with type declarations for pinned values. */
export function selectProjectPins(state: PortableState): PortableState {
	const names = new Set(state.pins);
	if (names.size) for (const binding of Object.values(state.bindings)) if (binding.kind === "type" || binding.kind === "enum") names.add(binding.name);
	let previousSize = -1;
	let selected = emptyState();
	while (names.size !== previousSize) {
		previousSize = names.size;
		for (const name of names) for (const dependency of state.bindings[name]?.references ?? []) if (Object.hasOwn(state.bindings, dependency)) names.add(dependency);
		selected = compactState({ ...state, roots: Object.fromEntries(Object.entries(state.roots).filter(([name]) => names.has(name))), bindings: Object.fromEntries(Object.entries(state.bindings).filter(([name]) => names.has(name))), nodes: { ...state.nodes } });
		for (const node of Object.values(selected.nodes)) if (node.kind === "recipe") names.add(node.name);
	}
	return selected;
}
