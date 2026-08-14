import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import type { NotebookBridgeServer } from "./bridge-server.ts";
import {
	garbageCollectSupersededNotebookCheckpoints,
	restoreNotebookCheckpoint,
	type NotebookCheckpointIdentity,
} from "./checkpoint.ts";
import { ensureNotebookDenoBinary } from "./deno-binary.ts";
import { initializeNotebookJournal, type NotebookJournal } from "./journal.ts";
import { DenoJupyterKernel } from "./jupyter-kernel.ts";
import { notebookBootstrapSource } from "./kernel-runtime.ts";
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

	const kernel = new DenoJupyterKernel({ deno, maxHeapMiB: runtime.maxHeapMiB });
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
		const journal = initializeNotebookJournal(checkpointIdentity);
		const baselineNames = new Set(await kernel.complete("", 0));
		const projectState = await restoreProjectState(kernel, {
			project,
			agentDir: runtime.agentDir,
			maxBytes: options.checkpointMaxBytes,
		});
		const restored = await restoreNotebookCheckpoint(kernel, checkpointIdentity, options.checkpointMaxBytes, projectState.baseline);
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
		garbageCollectSupersededNotebookCheckpoints(checkpointIdentity);
		const npmNotice = formatNotebookNpmImportsNotice(readNotebookNpmImports(checkpointIdentity));
		const restoreNotice = [npmNotice, formatProjectStateNotice(projectState), restored.message, profileNotice].filter(Boolean).join(". ") || undefined;
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
