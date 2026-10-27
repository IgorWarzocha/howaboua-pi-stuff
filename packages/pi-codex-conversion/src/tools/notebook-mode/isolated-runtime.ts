import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import type { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.ts";
import type { CodeModeToolDefinition, RuntimeResponse, ToolExecutionContext } from "../code-mode/types.ts";
import { checkpointPaths } from "./checkpoint-format.ts";
import { ensureNotebookDenoBinary } from "./deno-binary.ts";
import { NotebookExecutionRuntime } from "./execution-runtime.ts";
import { resolveNotebookProject } from "./project-identity.ts";
import { projectStatePaths } from "./project-state-format.ts";
import { withProjectStateLock } from "./project-state-lock.ts";
import { saveNotebookProfile, withProfileLock } from "./profile-state.ts";
import { assertSafeProfileDirectory, profileStatePaths } from "./profile-state-format.ts";
import { notebookSessionIdentity } from "./session-identity.ts";
import { NotebookSessionRuntime } from "./session-runtime.ts";

const MAX_ISOLATED_KERNELS = 4;

interface IsolatedRun {
	runtime: NotebookExecutionRuntime;
	session: NotebookSessionRuntime;
	controller: AbortController;
	ready: Promise<void>;
}

// Each fork owns its bridge and storage. Neither startup hooks nor checkpoint
// debounce can publish its bindings/pins into the ordinary session's baseline.
export class NotebookIsolatedRuntime {
	private readonly runs = new Map<string, IsolatedRun>();
	private readonly starting = new Set<IsolatedRun>();
	private stopping = false;
	private readonly options: NotebookRuntimeOptions;
	private readonly renderStore: CodeModeNestedRenderStore | undefined;
	private readonly readCommitted: (capture: () => Promise<void>) => Promise<void>;
	private identity: string | undefined;

	constructor(options: NotebookRuntimeOptions, readCommitted: (capture: () => Promise<void>) => Promise<void>, renderStore?: CodeModeNestedRenderStore) {
		this.options = options;
		this.readCommitted = readCommitted;
		this.renderStore = renderStore;
	}

	identityMatches(context: ToolExecutionContext): boolean {
		return !this.identity || this.identity === isolatedSessionIdentity(context);
	}

	has(cellId: string): boolean { return this.runs.has(cellId); }

	async execute(source: string, context: ToolExecutionContext, signal: AbortSignal | undefined, tools: CodeModeToolDefinition[]): Promise<RuntimeResponse> {
		signal?.throwIfAborted();
		if (this.stopping) throw new Error("Notebook is stopping; retry after restart completes");
		if (this.runs.size + this.starting.size >= MAX_ISOLATED_KERNELS) throw new Error(`Notebook allows ${MAX_ISOLATED_KERNELS} isolated cells at a time; wait for or terminate an isolated cell first`);
		const extension = context.extensionContext;
		if (!extension) throw new Error("Notebook requires a session context");
		this.identity = isolatedSessionIdentity(context);
		const controller = new AbortController();
		const runSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
		const directory = mkdtempSync(join(tmpdir(), "pi-deno-isolated-"));
		const candidate = `isolated-${randomUUID()}`;
		let session!: NotebookSessionRuntime;
		const runtime = new NotebookExecutionRuntime(() => session, (ctx, abort) => session.ensure(ctx, abort), this.renderStore, async (cell) => {
			try {
				if (cell.result?.status === "ok" && !cell.controller.signal.aborted) {
					const saved = await saveNotebookProfile({ name: candidate, kernel: session.kernel()!, project: resolveNotebookProject(context.cwd), agentDir: this.options.agentDir, baselineNames: session.baselineNames(), maxBytes: session.checkpointMaxBytes, signal: cell.controller.signal });
					cell.emit([{ type: "input_text", text: `Isolated state was not adopted. Saved candidate ${candidate}: ${saved.values} value(s), ${saved.definitions} definition(s), ${saved.skipped} skipped. Use notebook load with this name; existing binding collisions prevent overwrite. External tool and file effects are shared.` }]);
				}
			} finally {
				try { await session.shutdown(); }
				finally { rmSync(directory, { recursive: true, force: true }); }
			}
		}, candidate);
		session = new NotebookSessionRuntime({ runtime: { ...this.options, agentDir: directory }, bridge: runtime.bridge, runningCellId: () => runtime.runningCellId() });
		const run: IsolatedRun = { runtime, session, controller, ready: Promise.resolve() };
		this.starting.add(run);
		run.ready = (async () => {
			const project = resolveNotebookProject(context.cwd);
			const original = projectStatePaths(project, this.options.agentDir);
			mkdirSync(original.directory, { recursive: true });
			await this.readCommitted(() => withProjectStateLock(original.lock, async () => {
				copyDirectory(original.directory, projectStatePaths(project, directory).directory);
				const identity = { project, session: notebookSessionIdentity(extension) };
				copyDirectory(checkpointPaths({ ...identity, agentDir: this.options.agentDir }).directory, checkpointPaths({ ...identity, agentDir: directory }).directory);
			}, runSignal));
			const profileName = this.options.profile;
			if (profileName) {
				const profile = profileStatePaths(profileName, this.options.agentDir);
				assertSafeProfileDirectory(profile.directory, this.options.agentDir);
				if (existsSync(profile.directory)) await withProfileLock(profile.lock, async () => {
					copyDirectory(profile.directory, profileStatePaths(profileName, directory).directory);
				}, runSignal);
			}
			const binary = await ensureNotebookDenoBinary({ agentDir: this.options.agentDir }, runSignal);
			const destination = join(directory, relative(this.options.agentDir, binary));
			mkdirSync(dirname(destination), { recursive: true });
			copyFileSync(binary, destination, constants.COPYFILE_FICLONE);
		})();
		try {
			await run.ready;
			runSignal.throwIfAborted();
			const pending = runtime.execute(source, context, runSignal, tools);
			// The cell identity is assigned after asynchronous preparation; keep the
			// reservation until execute has returned its first observable response.
			const response = await pending;
			this.starting.delete(run);
			if (response.kind === "yielded") this.runs.set(response.cellId, run);
			else await this.dispose(run);
			return response;
		} catch (error) {
			await this.dispose(run);
			throw error;
		} finally { this.starting.delete(run); }
	}

	async wait(cellId: string, yieldTimeMs: number, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		const run = this.runs.get(cellId)!;
		const response = await run.runtime.wait(cellId, yieldTimeMs, context, signal);
		if (response.kind !== "yielded") { this.runs.delete(cellId); await this.dispose(run); }
		return response;
	}

	async terminate(cellId: string, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse> {
		const run = this.runs.get(cellId)!;
		try { return await run.runtime.terminate(cellId, context, signal); }
		finally { this.runs.delete(cellId); await this.dispose(run); }
	}

	clearOpaqueResults(): void { for (const run of [...this.runs.values(), ...this.starting]) run.runtime.clearOpaqueResults(); }

	async shutdown(): Promise<void> {
		this.stopping = true;
		try { await Promise.all([...new Set([...this.runs.values(), ...this.starting])].map(run => this.dispose(run))); }
		finally { this.runs.clear(); this.starting.clear(); this.identity = undefined; this.stopping = false; }
	}

	private async dispose(run: IsolatedRun): Promise<void> {
		run.controller.abort();
		await run.ready.catch(() => undefined);
		await run.session.abortStartup(new Error("Isolated cell stopped"));
		await run.runtime.stopActive().catch(() => undefined);
		try { await run.session.shutdown(); }
		finally {
			run.runtime.clear();
			rmSync(run.session.options.agentDir, { recursive: true, force: true });
		}
	}
}

function isolatedSessionIdentity(context: ToolExecutionContext): string {
	return `${resolveNotebookProject(context.cwd)}\0${context.extensionContext ? notebookSessionIdentity(context.extensionContext) : ""}`;
}

function copyDirectory(source: string, destination: string): void {
	if (!existsSync(source)) return;
	cpSync(source, destination, { recursive: true, filter: (path) => !path.endsWith("write.lock") });
}
