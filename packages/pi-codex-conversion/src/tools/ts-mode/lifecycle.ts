import { deserialize, serialize } from "node:v8";
import type { NotebookControlRequest, NotebookControlResult } from "../code-mode/types.ts";
import { globMatcher } from "../notebook-mode/glob.ts";
import { bindingDependencies, compactState, emptyState, forkPortableState, type BindingRecipe, type PortableCapture, type PortableState } from "./portable-state.ts";
import type { TsStateStorage } from "./state-storage.ts";

export interface TsLifecycleHost {
	state(): PortableState;
	capture(bindings?: Record<string, BindingRecipe>): Promise<PortableCapture>;
	validateCheckpoint(name: string, checkpoint: NonNullable<BindingRecipe["checkpoint"]>): Promise<void>;
	storage(): TsStateStorage;
	activeCells(): string[];
	commit(state: PortableState, action?: NotebookControlRequest["action"] | "adopt", released?: string[]): Promise<string | undefined>;
	syncProject(): Promise<string | undefined>;
	restart(): Promise<void>;
	reset(): Promise<void>;
}

export class TsStateLifecycle {
	private readonly host: TsLifecycleHost;
	constructor(host: TsLifecycleHost) { this.host = host; }

	async control(request: NotebookControlRequest): Promise<NotebookControlResult> {
		if (request.action === "hook") throw new Error("The hook action is available in JS Notebook only; use pin with hook in TS");
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
		if (this.host.activeCells().length) throw new Error("TS lifecycle changes require idle state; wait for or terminate active cells first. Status remains available.");
		// Reset and restart must also work when the live kernel is unavailable.
		if (request.action === "reset") { await this.host.reset(); return { message: "TS session reset to project pins; live-only values discarded; saved profiles unchanged", details: {} }; }
		if (request.action === "restart") { await this.host.restart(); return { message: "TS restarted from its last durable checkpoint; live-only values and changes since that checkpoint cannot be restored", details: {} }; }
		let registration: Record<string, BindingRecipe> | undefined;
		if (request.action === "pin" && request.checkpoint) {
			if (request.names.length !== 1 || request.hook !== undefined) throw new Error("TS checkpoint requires one binding and no hook");
			const name = request.names[0];
			const binding = name ? state.bindings[name] : undefined;
			if (!binding || !name) throw new Error(`No TS binding ${name}`);
			await this.host.validateCheckpoint(name, request.checkpoint);
			registration = { ...state.bindings, [name]: { ...binding, checkpoint: request.checkpoint } };
		}
		if (request.action === "unpin") {
			registration = structuredClone(state.bindings);
			for (const name of request.names) if (registration[name]) delete registration[name].checkpoint;
		}
		const capture = await this.host.capture(registration);
		const skippedNotice = formatSkipped(capture);
		if (request.action === "save") {
			await storage.writeProfile(request.name, capture.state);
			return { message: `TS profile ${request.name} saved${skippedNotice}`, details: { skipped: capture.skipped } };
		}
		const lostPins = capture.skipped.filter(({ name }) => state.pins.includes(name) && !(request.action === "unpin" && request.names.includes(name)));
		if (lostPins.length && !(request.action === "load" && request.name.startsWith("candidate-"))) throw new Error(`Cannot update durable TS pins: ${lostPins.map(({ name, reason }) => `${name} (${reason})`).join("; ")}. Live state is unchanged; restore a portable value or explicitly unpin it first`);
		if (request.action === "checkpoint") {
			const notice = await this.host.commit(capture.state, "checkpoint");
			return { message: `TS durable state saved${skippedNotice}${notice ? `\n${notice}` : ""}`, details: { skipped: capture.skipped } };
		}
		let next: PortableState = deserialize(serialize(capture.state));
		let released: string[] | undefined;
		switch (request.action) {
			case "load": {
				const loaded = request.name.startsWith("candidate-") ? await storage.read(request.name) : forkPortableState(await storage.readProfile(request.name));
				if (request.name.startsWith("candidate-")) { next = loaded; break; }
				const collisions = Object.keys(loaded.bindings).filter(name => Object.hasOwn(state.bindings, name));
				if (collisions.length) throw new Error(`TS profile ${request.name} conflicts with existing bindings: ${collisions.join(", ")}. Release or rename them before loading`);
				next = { ...next, roots: { ...next.roots, ...loaded.roots }, nodes: { ...next.nodes, ...loaded.nodes }, bindings: { ...next.bindings, ...loaded.bindings }, pins: [...new Set([...next.pins, ...loaded.pins])], imports: [...new Set([...next.imports, ...loaded.imports])] };
				break;
			}
			case "pin":
				for (const name of request.names) {
					const skipped = capture.skipped.find(entry => entry.name === name);
					if (skipped) throw new Error(`Cannot pin live-only TS binding ${name}: ${skipped.reason}. It remains available in this session`);
					const binding = next.bindings[name];
					if (!binding) throw new Error(`No TS binding ${name}`);
					if (request.hook && binding.kind !== "function") throw new Error(`TS hooks require a pinned function: ${name}`);
					if (request.hook !== undefined) { if (request.hook) binding.hook = request.hook; else delete binding.hook; }
					if (!next.pins.includes(name)) next.pins.push(name);
				}
				break;
			case "unpin":
				next.pins = next.pins.filter(name => !request.names.includes(name));
				for (const name of request.names) if (next.bindings[name]) { delete next.bindings[name].hook; delete next.bindings[name].checkpoint; }
				break;
			case "release": case "prune": {
				const matches = request.action === "release" ? (name: string) => request.names.includes(name) : globMatcher(request.query);
				const removed = new Set(Object.keys(state.bindings).filter(name => matches(name) && !state.pins.includes(name)));
				released = [...removed];
				for (const name of removed) { delete next.bindings[name]; delete next.roots[name]; }
				compactState(next);
				for (const binding of Object.values(state.bindings).filter(binding => !removed.has(binding.name))) {
					const dependency = bindingDependencies(binding).find(name => removed.has(name));
					if (dependency) throw new Error(`Cannot release ${dependency}: retained function ${binding.name} needs it. Release both together or redefine the helper first.`);
				}
				for (const node of Object.values(next.nodes)) if (node.kind === "recipe" && removed.has(node.name)) throw new Error(`Cannot release ${node.name}: a retained alias needs its function recipe. Release the alias too.`);
				for (const node of Object.values(next.nodes)) if (node.kind === "checkpoint" && (removed.has(node.snapshot) || removed.has(node.restore))) throw new Error(`Cannot release checkpoint helpers ${node.snapshot}, ${node.restore}: a retained checkpoint or alias needs them. Release its unpinned bindings too`);
				break;
			}
		}
		const adopting = request.action === "load" && request.name.startsWith("candidate-");
		const notice = await this.host.commit(next, adopting ? "adopt" : request.action, released);
		const releaseNotice = request.action === "release" || request.action === "prune" ? `\nKernel rebuilt so released names are reusable${capture.skipped.length ? `; live-only bindings discarded: ${capture.skipped.map(({ name }) => name).join(", ")}` : ""}` : "";
		const adoptNotice = adopting ? "\nCandidate replaced the live kernel; previous live-only values and unsaved changes were discarded" : "";
		return { message: `TS ${request.action} complete${skippedNotice}${releaseNotice}${adoptNotice}${notice ? `\n${notice}` : ""}`, details: { retainedBindings: Object.keys(next.bindings).length, pinnedBindings: next.pins.length, skipped: capture.skipped } };
	}

	private status(request: Extract<NotebookControlRequest, { action: "status" | "diagnostics" }>): NotebookControlResult {
		const state = this.host.state();
		const query = "query" in request ? request.query : undefined;
		const bindings = Object.values(state.bindings).filter(binding => !query || globMatcher(query)(binding.name)).map(binding => ({ name: binding.name, kind: binding.kind, declaration: binding.declaration, pinned: state.pins.includes(binding.name), hook: binding.hook }));
		const imports = state.imports.filter(specifier => specifier.startsWith("npm:"));
		const startupStatus = `TS state: ${Object.keys(state.bindings).length} bindings, ${state.pins.length} pinned${bindings.length ? `\n${bindings.map(binding => `${binding.name}: ${binding.kind}${binding.pinned ? " [pinned]" : ""}${binding.hook ? ` [${binding.hook}]` : ""}`).join("\n")}` : ""}\nAvailable npm imports in TS: ${imports.length ? imports.join(", ") : "none"}. Ask before adding another, then use an exact-version npm: specifier`;
		return { message: `${startupStatus}${query ? `\n${bindings.map(binding => binding.declaration).join("\n")}` : ""}\n${this.host.activeCells().length} active cells. Live closures and handles remain usable until restart; durable capture reports skipped bindings. Tool and file effects are not rolled back.`,
			details: { mode: "ts", startupStatus, bindings, retainedBindings: Object.keys(state.bindings).length, pinnedBindings: state.pins.length, activeCells: this.host.activeCells(), imports, ...(request.action === "diagnostics" ? { storage: this.host.storage().directory } : {}) } };
	}
}

export function formatSkipped(capture: PortableCapture): string {
	return capture.skipped.length ? `\nLive-only bindings not saved: ${capture.skipped.map(({ name, reason }) => `${name} (${reason})`).join("; ")}` : "";
}

/** Enums have both value and type authority; retain them with type declarations for pinned values. */
export function selectProjectPins(state: PortableState): PortableState {
	const names = new Set(state.pins);
	if (!names.size) return { ...state, roots: {}, nodes: {}, bindings: {} };
	for (const binding of Object.values(state.bindings)) if (binding.kind === "type" || binding.kind === "enum") names.add(binding.name);
	let previousSize = -1;
	let selected = emptyState();
	while (names.size !== previousSize) {
		previousSize = names.size;
		for (const name of names) { const binding = state.bindings[name]; if (binding) for (const dependency of bindingDependencies(binding)) if (Object.hasOwn(state.bindings, dependency)) names.add(dependency); }
		selected = compactState({ ...state, roots: Object.fromEntries(Object.entries(state.roots).filter(([name]) => names.has(name))), bindings: Object.fromEntries(Object.entries(state.bindings).filter(([name]) => names.has(name))), nodes: { ...state.nodes } });
		for (const node of Object.values(selected.nodes)) { if (node.kind === "recipe") names.add(node.name); if (node.kind === "checkpoint") { names.add(node.snapshot); names.add(node.restore); } }
	}
	return selected;
}
