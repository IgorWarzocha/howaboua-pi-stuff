import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import { notebookExecStartupNotice } from "./control-contract.ts";
import type { NotebookBridgeServer } from "./bridge-server.ts";
import {
	garbageCollectSupersededNotebookCheckpoints,
	restoreNotebookCheckpoint,
	type NotebookCheckpointIdentity,
} from "./checkpoint.ts";
import { ensureNotebookDenoBinary } from "./deno-binary.ts";
import { initializeNotebookJournal, type NotebookJournal } from "./journal.ts";
import { DenoJupyterKernel } from "./jupyter-kernel.ts";
import { notebookBootstrapSource, notebookExampleSource } from "./kernel-runtime.ts";
import { formatNotebookNpmImportsNotice, readNotebookNpmImports } from "./npm-imports.ts";
import {
	formatProjectStateNotice,
	restoreProjectState,
	type ProjectStateBaseline,
} from "./project-state.ts";
import { resolveNotebookProject } from "./project-identity.ts";
import { loadNotebookProfile, NotebookProfileRestoreError } from "./profile-state.ts";
import { notebookSessionIdentity } from "./session-identity.ts";

export interface StartedNotebookSession {
	kernel: DenoJupyterKernel;
	journal: NotebookJournal;
	checkpointIdentity: NotebookCheckpointIdentity;
	baselineNames: Set<string>;
	projectBaseline: ProjectStateBaseline;
	configuredProfileLoaded: boolean;
	restoreNotice?: string | undefined;
}

export async function startNotebookSession(options: {
	context: ExtensionContext;
	runtime: NotebookRuntimeOptions;
	bridge: NotebookBridgeServer;
	checkpointMaxBytes: number;
	onKernelFailure?: ((kernel: DenoJupyterKernel, error: Error) => void) | undefined;
	signal?: AbortSignal | undefined;
}): Promise<StartedNotebookSession> {
	const { context, runtime, bridge, signal } = options;
	const startupAbort = new AbortController();
	const startupSignal = signal ? AbortSignal.any([signal, startupAbort.signal]) : startupAbort.signal;
	const denoPending = ensureNotebookDenoBinary({ agentDir: runtime.agentDir }, startupSignal);
	const bridgePending = bridge.start();
	let deno: string;
	let origin: string;
	try {
		[deno, origin] = await Promise.all([denoPending, bridgePending]);
		startupSignal.throwIfAborted();
	} catch (error) {
		startupAbort.abort();
		await Promise.allSettled([denoPending, bridgePending]);
		await bridge.shutdown().catch(() => undefined);
		throw error;
	}

	const kernel = new DenoJupyterKernel({ deno, maxHeapMiB: runtime.maxHeapMiB, onFailure: options.onKernelFailure });
	try {
		await kernel.start(signal);
		const bootstrap = await kernel.execute(notebookBootstrapSource(origin, bridge.token, bridge.exitToken, context.cwd), { signal });
		if (bootstrap.status !== "ok") {
			throw new Error(`Notebook bootstrap failed: ${bootstrap.errorText ?? "unknown error"}`);
		}
		const project = resolveNotebookProject(context.cwd);
		const checkpointIdentity = {
			project,
			session: notebookSessionIdentity(context),
			agentDir: runtime.agentDir,
		};
		const journal = initializeNotebookJournal(checkpointIdentity, options.checkpointMaxBytes);
		const baselineNames = new Set(await kernel.complete("", 0, signal));
		const projectState = await restoreProjectState(kernel, {
			project,
			agentDir: runtime.agentDir,
			maxBytes: options.checkpointMaxBytes,
			signal,
		});
		const restored = await restoreNotebookCheckpoint(kernel, checkpointIdentity, options.checkpointMaxBytes, projectState.baseline, signal);
		let profileNotice: string | undefined;
		let configuredProfileLoaded = false;
		if (runtime.profile) {
			try {
				const profile = await loadNotebookProfile({
					name: runtime.profile,
					kernel,
					agentDir: runtime.agentDir,
					baselineNames,
					maxBytes: options.checkpointMaxBytes,
					signal,
				});
				profileNotice = profile.collisions.length > 0
					? `Notebook profile ${runtime.profile} was not loaded because ${profile.collisions.length} binding collision(s) already exist`
					: `Notebook profile ${runtime.profile} loaded ${profile.loaded.length} binding(s)`;
				configuredProfileLoaded = profile.collisions.length === 0;
			} catch (error) {
				if (signal?.aborted || error instanceof NotebookProfileRestoreError) throw error;
				profileNotice = `Notebook profile ${runtime.profile} was not loaded: ${error instanceof Error ? error.message : String(error)}`;
			}
		}
		const exampleNames = await installNotebookExamples(kernel, signal);
		for (const name of exampleNames) baselineNames.add(name);
		garbageCollectSupersededNotebookCheckpoints(checkpointIdentity);
		const npmNotice = formatNotebookNpmImportsNotice(readNotebookNpmImports(checkpointIdentity));
		const exampleNotice = exampleNames.length === 2
			? "Notebook example foo/bar available; inspect foo.description, foo.usage, bar.description, and bar.usage before constructing a reusable global"
			: undefined;
		const restoreNotice = [exampleNotice, npmNotice, formatProjectStateNotice(projectState), restored.message, profileNotice, notebookExecStartupNotice()].filter(Boolean).join(". ") || undefined;
		return {
			kernel,
			journal,
			checkpointIdentity,
			baselineNames,
			projectBaseline: projectState.baseline,
			configuredProfileLoaded,
			...(restoreNotice ? { restoreNotice } : {}),
		};
	} catch (error) {
		await kernel.shutdown().catch(() => undefined);
		await bridge.shutdown().catch(() => undefined);
		throw error;
	}
}

async function installNotebookExamples(kernel: DenoJupyterKernel, signal?: AbortSignal): Promise<string[]> {
	const marker = `__PI_NOTEBOOK_EXAMPLES_${randomUUID()}__`;
	signal?.throwIfAborted();
	try {
		const names = new Set(await kernel.complete("", 0, signal));
		const result = await kernel.execute(notebookExampleSource(marker, names.has("foo") || names.has("bar")), { signal });
		if (result.status !== "ok") return [];
		const output = result.items.filter(({ type }) => type === "input_text").map(({ text }) => text ?? "").join("");
		const start = output.indexOf(marker);
		if (start === -1) return [];
		const value = JSON.parse(output.slice(start + marker.length).split("\n", 1)[0]!) as unknown;
		return Array.isArray(value) && value.every((name) => name === "foo" || name === "bar")
			? [...new Set(value)]
			: [];
	} catch {
		signal?.throwIfAborted();
		return [];
	}
}
