import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotebookControlResult, ToolExecutionContext } from "../code-mode/types.ts";
import {
	notebookCheckpointBindingNames,
	removeNotebookCheckpoint,
	type NotebookCheckpointIdentity,
} from "./checkpoint.ts";
import { ensureNotebookDenoBinary } from "./deno-binary.ts";
import { initializeNotebookJournal } from "./journal.ts";
import { diagnoseNotebook } from "./notebook-diagnostics.ts";
import { resolveNotebookProject } from "./project-identity.ts";
import { notebookProfileBindingNames } from "./profile-state.ts";
import { projectStateBindingNames } from "./project-state.ts";
import { readRetainedProjectBindings } from "./project-state-metadata.ts";
import type { NotebookRuntimeHealth } from "./runtime-health.ts";
import { notebookSessionIdentity } from "./session-identity.ts";

interface NotebookRecoveryHost {
	stopWithoutCheckpoint(): Promise<string | undefined>;
	startClean(context: ExtensionContext, signal?: AbortSignal): Promise<void>;
	checkpointEmpty(): Promise<void>;
	configuredProfileActive(): boolean;
	runtimeHealth(context: ExtensionContext): NotebookRuntimeHealth;
}

export class NotebookRecoveryController {
	private readonly agentDir: string;
	private readonly maxBytes: number;
	private readonly profile: string | undefined;
	private readonly host: NotebookRecoveryHost;

	constructor(
		options: { agentDir: string; maxBytes: number; profile?: string | undefined },
		host: NotebookRecoveryHost,
	) {
		this.agentDir = options.agentDir;
		this.maxBytes = options.maxBytes;
		this.profile = options.profile;
		this.host = host;
	}

	async diagnostics(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		const identity = this.identity(context, "diagnostics");
		const journal = initializeNotebookJournal(identity, this.maxBytes);
		const deno = await ensureNotebookDenoBinary({ agentDir: this.agentDir }, signal);
		const runtimeBindings = new Set([
			...projectStateBindingNames(identity, this.maxBytes),
			...notebookCheckpointBindingNames(identity, this.maxBytes),
			...(this.host.configuredProfileActive()
				? notebookProfileBindingNames(this.profile, this.agentDir, this.maxBytes)
				: []),
		]);
		return diagnoseNotebook({ deno, cwd: identity.project, path: journal.path, runtimeBindings, runtimeHealth: this.host.runtimeHealth(requireExtensionContext(context, "diagnostics")).state, signal });
	}

	async reset(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		signal?.throwIfAborted();
		const extension = requireExtensionContext(context, "reset");
		const identity = notebookIdentity(extension, this.agentDir);
		const retained = readRetainedProjectBindings(identity, this.maxBytes);
		const pinned = retained.filter(({ pinned: isPinned }) => isPinned).length;
		const activeCell = await this.host.stopWithoutCheckpoint();
		removeNotebookCheckpoint(identity);
		await this.host.startClean(extension, signal);
		await this.host.checkpointEmpty();
		return {
			message: `Notebook reset to durable project state; preserved ${retained.length} project binding${retained.length === 1 ? "" : "s"}${pinned > 0 ? ` including ${pinned} pinned` : ""}${activeCell ? ` and terminated ${activeCell}` : ""}. The session checkpoint was discarded; saved notebook and named profiles were preserved`,
			details: {
				project: identity.project,
				preservedProjectBindings: retained.length,
				preservedPinnedBindings: pinned,
				discardedSessionCheckpoint: true,
				...(activeCell ? { terminatedCell: activeCell } : {}),
			},
		};
	}

	private identity(context: ToolExecutionContext, action: string): NotebookCheckpointIdentity {
		return notebookIdentity(requireExtensionContext(context, action), this.agentDir);
	}
}

function notebookIdentity(context: ExtensionContext, agentDir: string): NotebookCheckpointIdentity {
	return {
		project: resolveNotebookProject(context.cwd),
		session: notebookSessionIdentity(context),
		agentDir,
	};
}

function requireExtensionContext(context: ToolExecutionContext, action: string): ExtensionContext {
	if (!context.extensionContext) throw new Error(`Notebook ${action} requires an extension session context`);
	return context.extensionContext;
}
