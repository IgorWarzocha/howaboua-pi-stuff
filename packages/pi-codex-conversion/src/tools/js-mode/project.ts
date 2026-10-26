import { randomUUID } from "node:crypto";
import { RuntimeInstallError } from "../code-mode/runtime-package.ts";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import type { NotebookControlRequest, NotebookControlResult } from "../code-mode/types.ts";
import { globMatcher } from "../notebook-mode/glob.ts";
import { emptyState, forkPortableState } from "../ts-mode/portable-state.ts";
import { JsKernel } from "./kernel.ts";
import { loadJsRuntime, type JsRuntime } from "./runtime.ts";
import { JsStateStorage } from "./storage.ts";
import { JsDataStorage } from "./data-storage.ts";
import type { JsBindingStatus, JsInput, JsOutcome, JsSnapshot, JsTool } from "./protocol.ts";

const NO_TOOLS = { output: () => {}, notify: () => {}, yield: () => {}, request: async (): Promise<never> => { throw new Error("Tools are unavailable during checkpoint management"); } };

/** Owns the live heap and its durable project image; the client owns scheduling. */
export class JsNotebookProject {
	private storage: JsStateStorage | undefined;
	private dataStorage: JsDataStorage | undefined;
	private observedProject = emptyState();
	private pins: string[] = [];
	private projectWarning: string | undefined;
	private durable: JsSnapshot | undefined;
	private dirty = false;
	private migrationNotice: string | undefined;
	private kernel: JsKernel | undefined;
	private runtime: JsRuntime | undefined;
	private runtimeAbort = new AbortController();
	private unavailable = false;
	private startupError: string | undefined;
	private heapBytes = 0;
	private latestTools: JsTool[] = [];
	private bindings: JsBindingStatus[] = [];
	private inventoryComplete = true;
	private hooks: NonNullable<JsOutcome["hooks"]> = [];

	private readonly options: NotebookRuntimeOptions;
	constructor(options: NotebookRuntimeOptions) { this.options = options; }
	get stopped(): boolean { return this.unavailable; }
	get error(): string | undefined { return this.startupError; }
	recordStartupError(error: unknown): void { this.startupError = error instanceof Error ? error.message : String(error); }
	get warning(): string | undefined { return this.projectWarning; }
	get snapshot(): JsSnapshot | undefined { return this.durable; }
	async isolationBaseline(): Promise<JsSnapshot> {
		// Atomic rename publishes whole checkpoints. Read the opened image, not the
		// live heap: its writer may hold the project lease while awaiting a tool.
		// Do not refresh/adopt here; other processes may have committed newer state.
		const snapshot = await this.requireStorage().read();
		if (!snapshot) throw new Error("The project notebook checkpoint is unavailable; retry after its reset finishes");
		return snapshot;
	}
	get startupAborted(): boolean { return this.runtimeAbort.signal.aborted; }
	startupSignal(signal?: AbortSignal): AbortSignal { return signal ? AbortSignal.any([signal, this.runtimeAbort.signal]) : this.runtimeAbort.signal; }
	abortStartup(): void { this.runtimeAbort.abort(); }
	renewStartup(): void { this.runtimeAbort = new AbortController(); }
	setTools(tools: JsTool[]): void { this.latestTools = tools; }
	invalidate(): void { this.unavailable = true; }
	takeMigrationNotice(): string | undefined { const notice = this.migrationNotice; this.migrationNotice = undefined; return notice; }
	withLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> { return this.requireStorage().withLock(operation, signal); }
	get available(): boolean { return !!this.storage && !this.unavailable; }
	async hasDataProfile(name: string): Promise<boolean> { return !!await this.requireDataStorage().readProfile(name); }
	async list(query?: string): Promise<NotebookControlResult> {
		const profiles = await this.requireStorage().list(query); return { message: JSON.stringify({ profiles }), details: { mode: "js", profiles } };
	}
	private async createKernel(heapBytes: number, snapshot?: JsSnapshot, managementClone = false, signal?: AbortSignal): Promise<JsKernel> {
		signal = signal ? AbortSignal.any([signal, this.runtimeAbort.signal]) : this.runtimeAbort.signal;
		const runtime = this.runtime ?? await loadJsRuntime(this.options.agentDir, signal);
		signal.throwIfAborted();
		this.runtime = runtime;
		return JsKernel.create(runtime, heapBytes, snapshot, managementClone);
	}
	bindStorage(cwd: string, identity: string): void {
		this.storage = new JsStateStorage(this.options.agentDir, cwd, identity, this.liveBudget() * 2);
		this.dataStorage = new JsDataStorage(this.options.agentDir, cwd, this.liveBudget() * 2);
	}
	async initialize(inspectionOnly: boolean, signal?: AbortSignal): Promise<void> {
		if (inspectionOnly) { this.durable = await this.requireStorage().read(); if (this.durable) await this.restoreInitial(signal); return; }
		await this.requireStorage().withLock(async () => {
			if (await this.requireStorage().migrateLegacy()) this.migrationNotice = "Resumed this conversation’s previous notebook as the shared project notebook";
			this.durable = await this.requireStorage().read();
			if (!this.durable && this.options.profile) {
				const selected = await this.requireDataStorage().readProfile(this.options.profile);
				if (selected) {
					this.kernel = await this.createKernel(this.liveBudget(), undefined, false, signal);
					const result = await this.kernel.execute({ tools: [], data: { action: "import", state: forkPortableState(selected) } }, NO_TOOLS);
					if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "JS data profile could not be restored");
					this.durable = result.snapshot;
				} else this.durable = await this.requireStorage().read(this.options.profile);
				if (this.durable) { this.durable = { ...this.durable, pins: [] }; delete this.durable.observedProject; await this.requireStorage().write(this.durable); }
			}
			await this.restoreInitial(signal);
		}, signal);
	}
	async close(): Promise<void> {
		await this.kernel?.stop();
		this.dirty = false; this.migrationNotice = undefined; this.kernel = undefined; this.storage = undefined; this.dataStorage = undefined; this.durable = undefined;
		this.observedProject = emptyState(); this.pins = []; this.projectWarning = undefined;
		this.unavailable = false; this.startupError = undefined; this.heapBytes = 0; this.latestTools = [];
		this.bindings = []; this.inventoryComplete = true; this.hooks = [];
	}
	async inspect(signal?: AbortSignal): Promise<void> {
		this.kernel ??= await this.createKernel(this.liveBudget(), this.durable, false, signal);
		const result = await this.kernel.execute({ tools: this.latestTools, inspect: "*" }, NO_TOOLS);
		if (result.error !== undefined) throw new Error(result.error);
		this.recordInventory(result);
	}
	async restart(reset: boolean, signal: AbortSignal | undefined, retryStartup: () => void): Promise<NotebookControlResult> {
		await this.kernel?.stop(); this.kernel = undefined;
		if (reset) { await this.requireStorage().reset(); this.durable = undefined; }
		else this.durable = await this.requireStorage().read();
		this.dirty = false; this.startupError = undefined; this.observedProject = emptyState(); this.pins = []; this.hooks = []; this.projectWarning = undefined;
		try { await this.restoreInitial(signal); } catch (error) {
			if (signal?.aborted || this.runtimeAbort.signal.aborted || error instanceof RuntimeInstallError) retryStartup();
			else this.recordStartupError(error);
			throw error;
		}
		this.bindings = []; this.inventoryComplete = this.durable?.inventory?.complete ?? !this.durable;
		this.unavailable = false;
		return { message: reset ? "JS Notebook project reset; project pins and named profiles remain" : "JS Notebook will resume from its last checkpoint; later changes were discarded. Tool and file effects were not rolled back", details: { mode: "js", action: reset ? "reset" : "restart" } };
	}
	async control(request: NotebookControlRequest, signal?: AbortSignal): Promise<NotebookControlResult> {
		if (request.action === "hook") {
			await this.mutate({ hook: { name: request.name, event: request.event } });
			return this.managedResult(request.event === false ? `Removed hook ${request.name}` : `Registered ${request.name} for ${request.event}`, { hooks: this.hooks });
		}
		if (request.action === "pin" || request.action === "unpin" || request.action === "release" || request.action === "prune") {
			if (request.action === "pin" && (request.hook !== undefined || request.checkpoint !== undefined)) throw new Error("Use notebook hook for JS hooks; pins support plain data only");
			const current = await this.liveSnapshot();
			const names = request.action === "prune" ? (current.bindings ?? []).filter(binding => globMatcher(request.query)(binding.name)).map(binding => binding.name) : request.names;
			const result = await this.mutate({ data: { action: request.action === "prune" ? "release" : request.action, names } }, current.snapshot);
			return this.managedResult(result.release ? `${JSON.stringify(result.release)}${result.release.legacyRetained.length ? "\nNames released; values from older checkpoints can remain in the old native scope." : ""}\nOther aliases and closures are retained.` : `${request.action === "pin" ? "Pinned" : "Unpinned"} ${names.join(", ")}`, { pins: this.pins, ...(result.release ? { release: result.release } : {}) });
		}
		if (request.action === "load") {
			const selected = await this.requireDataStorage().readProfile(request.name);
			if (selected) {
				await this.mutate({ data: { action: "import", state: forkPortableState(selected) } });
				return this.managedResult(`Loaded selected data from ${request.name}; existing bindings were preserved`, { action: "load", name: request.name });
			}
			const saved = await this.requireStorage().read(request.name);
			if (!saved) throw new Error("JS Notebook profile is unavailable");
			if (saved.observedProject && saved.observedProject.key !== this.requireDataStorage().projectKey) throw new Error("This isolated candidate belongs to a different project; save a whole-notebook profile there before loading it here");
			if (saved.projectRevision && saved.projectRevision !== (await this.requireStorage().read())?.projectRevision) {
				const recovery = { ...saved }; delete recovery.projectRevision;
				const name = `recovery-${randomUUID()}`;
				await this.requireStorage().write(recovery, name);
				throw new Error(`The project notebook changed since this isolated candidate started; it was not loaded. To deliberately replace the current notebook with this candidate, load ${name}`);
			}
			const candidate = await this.createKernel(this.liveBudget(), saved, false, signal);
			try {
				const result = await candidate.execute({ tools: this.latestTools }, NO_TOOLS);
				if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "The saved notebook could not be restored");
				const snapshot = { ...result.snapshot, observedProject: saved.observedProject ?? { key: this.requireDataStorage().projectKey, state: emptyState() } };
				await this.requireStorage().write(snapshot);
				await this.kernel?.stop(); this.kernel = candidate; this.durable = snapshot; this.dirty = false; this.observedProject = snapshot.observedProject.state; this.unavailable = false;
				this.recordInventory(result);
				await this.syncProject(result);
			} catch (error) { await candidate.stop(); throw error; }
			return this.managedResult(`Loaded ${request.name}; the entire JS Notebook state was replaced`, { action: "load", name: request.name });
		}
		if (request.action === "checkpoint" || request.action === "save") {
			if (request.action === "save" && request.names) {
				if (this.unavailable) throw new Error("JS Notebook stopped; restart before saving");
				this.kernel ??= await this.createKernel(this.liveBudget(), this.durable, false, signal);
				const result = await this.kernel.execute({ tools: this.latestTools, data: { action: "export", names: request.names } }, NO_TOOLS);
				if (result.error !== undefined || !result.data) throw new Error(result.error ?? "Selected JS data could not be saved");
				await this.requireDataStorage().writeProfile(request.name, result.data);
				return { message: `Saved selected JS data as ${request.name}`, details: { mode: "js", names: request.names } };
			}
			const snapshot = await this.capture();
			if (request.action === "save") { const profile = { ...snapshot, pins: [] }; delete profile.observedProject; delete profile.projectRevision; await this.requireStorage().write(profile, request.name); }
			return this.managedResult(request.action === "save" ? `Saved complete JS Notebook as ${request.name}; project pin registrations are not included` : "JS Notebook checkpoint saved", { action: request.action, checkpointBytes: snapshot.bytes.length });
		}
		throw new Error("This JS Notebook control is unavailable. Call notebook for supported actions");
	}
	async refreshProject(signal?: AbortSignal): Promise<void> {
		const latest = await this.requireStorage().read(undefined, this.durable);
		if (latest?.projectRevision === this.durable?.projectRevision) return;
		if (this.dirty && this.kernel && !this.unavailable) {
			const recovery = await this.liveSnapshot();
			const name = `recovery-${randomUUID()}`;
			await this.requireStorage().write(recovery.snapshot, name);
			throw new Error(`Another conversation updated this project notebook. Your live changes remain here and were saved as ${name}; restart to use the shared state, or explicitly load that profile to replace it`);
		}
		await this.kernel?.stop(); this.kernel = undefined;
		this.durable = latest; this.bindings = []; this.hooks = []; this.pins = [];
		this.unavailable = false; this.startupError = undefined;
		await this.restoreInitial(signal);
	}
	private requireStorage(): JsStateStorage { if (!this.storage) throw new Error("JS Notebook session is unavailable"); return this.storage; }
	private requireDataStorage(): JsDataStorage { if (!this.dataStorage) throw new Error("JS Notebook project is unavailable"); return this.dataStorage; }
	private liveBudget(): number { return Math.floor(this.options.maxHeapMiB * 1024 * 1024 / 2); }
	status(activeCells: string[], query = "*"): NotebookControlResult {
		const matches = this.bindings.filter(binding => globMatcher(query)(binding.name));
		const bindings = matches.slice(0, 256);
		const startupStatus = this.startupError ?? (this.unavailable ? "JS Notebook stopped; use notebook restart to restore its checkpoint" : [
			`JS state: ${this.bindings.length} known bindings`,
			...(this.migrationNotice ? [this.migrationNotice] : []),
			...bindings.map(binding => `${binding.name}: ${binding.kind} (${binding.type})`),
			...(matches.length > bindings.length ? ["Binding list truncated; narrow the status query"] : []),
			...(this.inventoryComplete ? [] : ["This older checkpoint predates binding tracking; earlier names still exist but are not listed"]),
			...(activeCells.length ? ["Inventory is from the last completed cell"] : []),
		].join("\n"));
		const details = { mode: "js", startupStatus, bindings, hooks: this.hooks, pins: this.pins, projectWarning: this.projectWarning, retainedBindings: this.bindings.length, inventoryComplete: this.inventoryComplete, activeCells, checkpointBytes: this.durable?.bytes.length ?? 0, heapBytes: this.heapBytes, ...(this.startupError ? { error: this.startupError } : {}) };
		return { message: JSON.stringify(details), details };
	}
	private recordInventory(result: JsOutcome): void {
		if (result.pins) this.pins = result.pins;
		if (result.hooks) this.hooks = result.hooks;
		if (result.bindings) this.bindings = result.bindings;
		if (result.inventoryComplete !== undefined) this.inventoryComplete = result.inventoryComplete;
		this.heapBytes = result.heapBytes;
	}
	async capture(): Promise<JsSnapshot> {
		const result = await this.liveSnapshot(false);
		await this.commit(result); return this.durable!;
	}
	private async liveSnapshot(management = true): Promise<JsOutcome & { snapshot: JsSnapshot }> {
		if (this.unavailable) throw new Error("JS Notebook stopped; restart before changing saved state");
		this.kernel ??= await this.createKernel(this.liveBudget(), this.durable);
		const result = await this.kernel.execute({ tools: this.latestTools, management }, NO_TOOLS);
		if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "JS Notebook checkpoint failed");
		return { ...result, snapshot: result.snapshot };
	}
	private async mutate(input: Pick<JsInput, "data" | "hook">, snapshot?: JsSnapshot): Promise<JsOutcome> {
		const before = snapshot ?? (await this.liveSnapshot()).snapshot;
		const candidate = await this.createKernel(this.liveBudget(), before, true);
		let adopted = false;
		try {
			const result = await candidate.execute({ tools: this.latestTools, ...input }, NO_TOOLS);
			if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "JS Notebook state change failed");
			await this.commit(result);
			await this.kernel?.stop(); this.kernel = candidate; adopted = true;
			return result;
		} finally { if (!adopted) await candidate.stop(); }
	}
	private async restoreInitial(signal?: AbortSignal): Promise<void> {
		const storage = this.requireDataStorage();
		if (this.durable) {
			if (this.durable.observedProject && this.durable.observedProject.key !== storage.projectKey) throw new Error("Saved JS Notebook project differs from this session; use a named whole-notebook profile to transfer state");
			this.observedProject = this.durable.observedProject?.state ?? emptyState(); this.pins = this.durable.pins ?? [];
			return;
		}
		const project = await storage.readProject(); this.observedProject = project;
		const candidate = await this.createKernel(this.liveBudget(), undefined, false, signal);
		try {
			const result = await candidate.execute({ tools: [], management: true, ...(project.pins.length ? { data: { action: "import" as const, state: project, pins: project.pins } } : {}) }, NO_TOOLS);
			if (result.error !== undefined || !result.snapshot) throw new Error(result.error ?? "Project pins could not be restored");
			signal?.throwIfAborted();
			await this.commit(result, false); this.kernel = candidate;
		} catch (error) { await candidate.stop(); throw error; }
	}
	async commit(result: JsOutcome, sync = true): Promise<void> {
		if (!result.snapshot) throw new Error("JS Notebook checkpoint is unavailable");
		const snapshot = { ...result.snapshot, observedProject: { key: this.requireDataStorage().projectKey, state: this.observedProject } };
		await this.requireStorage().write(snapshot); this.durable = snapshot; this.dirty = false; this.recordInventory(result);
		if (sync) await this.syncProject(result);
	}
	private async syncProject(result: JsOutcome): Promise<void> {
		this.projectWarning = undefined;
		try {
			if (result.pinError) throw new Error(result.pinError);
			if (!this.pins.length && !this.observedProject.pins.length) return;
			const candidate = result.pinState ?? emptyState();
			await this.requireDataStorage().writeProject(candidate);
			this.observedProject = candidate;
			if (this.durable) { this.durable = { ...this.durable, observedProject: { key: this.requireDataStorage().projectKey, state: candidate } }; await this.requireStorage().write(this.durable); }
		} catch (error) { this.projectWarning = `Project checkpoint saved, but reset-survival pins were not fully synchronized: ${error instanceof Error ? error.message : String(error)}`; }
	}
	private managedResult(message: string, details: Record<string, unknown>): NotebookControlResult {
		if (this.projectWarning) throw new Error(`${message}\n${this.projectWarning}`);
		return { message, details: { mode: "js", ...details } };
	}
	async cellKernel(isolated: boolean, maxCells: number, signal: AbortSignal, baseline?: JsSnapshot): Promise<JsKernel> {
		return isolated ? this.createKernel(Math.floor(this.liveBudget() / maxCells), baseline, false, signal) : this.kernel ?? this.createKernel(this.liveBudget(), this.durable, false, signal);
	}
	adoptLiveKernel(kernel: JsKernel): void { this.kernel = kernel; }
	recordCell(result: JsOutcome): void { this.dirty = true; this.recordInventory(result); }
	async saveCandidate(snapshot: JsSnapshot, name: string, baseline?: JsSnapshot): Promise<void> {
		await this.requireStorage().write({ ...snapshot, ...(baseline?.projectRevision ? { projectRevision: baseline.projectRevision } : {}), observedProject: baseline?.observedProject ?? { key: this.requireDataStorage().projectKey, state: emptyState() } }, name);
	}
}
