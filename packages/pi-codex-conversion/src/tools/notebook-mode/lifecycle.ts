import { readNotebookStatus } from "./lifecycle-status.ts";
import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	NotebookControlRequest,
	NotebookControlResult,
	NotebookHook,
	NotebookMemoryUsage,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";
import { globMatcher } from "./glob.ts";
import { notebookToolHooksSource } from "./kernel-runtime.ts";
import type { RetainedProjectBinding } from "./project-state-metadata.ts";
import type { ProjectStatePinUpdate } from "./project-state-merge.ts";
import {
	boundedReleaseDetails,
	formatNameList,
	formatRelease,
	NOTEBOOK_DETAILS_BUDGET,
	takeDetailValues,
	withinNameBudget,
} from "./lifecycle-result.ts";
import {
	notebookDisposeSource,
	notebookReleaseSource,
	notebookStatusSource,
	parseNotebookRuntimeResult,
	type NotebookKernelStatus,
	type NotebookReleaseResult,
} from "./lifecycle-runtime.ts";
import { NotebookProfileController } from "./profile-lifecycle.ts";
import { withNotebookRecoveryGuidance, type NotebookRuntimeHealth } from "./runtime-health.ts";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface NotebookLifecycleHost {
	prepare(context: ToolExecutionContext, signal?: AbortSignal): Promise<void>;
	diagnostics(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult>;
	reset(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult>;
	unpinWithoutStartup(names: string[], context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult>;
	kernel(): DenoJupyterKernel | undefined;
	activeCellId(): string | undefined;
	stopActive(): Promise<string | undefined>;
	checkpoint(excludeNames?: ReadonlySet<string>, pins?: ProjectStatePinUpdate): Promise<void>;
	retainedBindings(): RetainedProjectBinding[];
	promoteBindings(names: string[]): Promise<() => Promise<void>>;
	markChanged(): void;
	restart(context: ExtensionContext, signal?: AbortSignal): Promise<string | undefined>;
	rollback(context: ExtensionContext): Promise<void>;
	baselineNames(): ReadonlySet<string>;
	profileStorage(): { agentDir: string; maxBytes: number };
	runtimeHealth(): NotebookRuntimeHealth;
	metadata(): {
		startedAt?: number | undefined;
		userCells: number;
		memory?: NotebookMemoryUsage | undefined;
		checkpoint: Record<string, unknown>;
	};
}

export class NotebookLifecycleController {
	private readonly host: NotebookLifecycleHost;
	private readonly profiles: NotebookProfileController;

	constructor(host: NotebookLifecycleHost) {
		this.host = host;
		this.profiles = new NotebookProfileController(host);
	}

	async control(
		request: NotebookControlRequest,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<NotebookControlResult> {
		if (request.action === "list") return this.profiles.list(request.query);
		if (request.action === "diagnostics") return this.host.diagnostics(context, signal);
		if (request.action === "reset") return this.host.reset(context, signal);
		if (request.action === "unpin" && this.host.runtimeHealth().state !== "ready") return this.host.unpinWithoutStartup(request.names, context, signal);
		if (request.action === "restart" && this.host.runtimeHealth().state !== "ready") return this.restart(context, signal);
		await this.host.prepare(context, signal);
		switch (request.action) {
			case "hook": throw new Error("The hook action is available in JS Notebook only; use pin with hook in this mode");
			case "status": return readNotebookStatus(this.host, (kernel, signal) => this.userBindingNames(kernel, signal), request.query, signal);
			case "checkpoint": return this.checkpoint();
			case "save": return this.profiles.save(request.name, context, signal);
			case "load": return this.profiles.load(request.name, context, signal);
			case "pin": return this.pin(request.names, true, request.hook);
			case "unpin": return this.pin(request.names, false);
			case "release": return this.release(request.names, context, signal);
			case "prune": return this.prune(request.query, context, signal);
			case "restart": return this.restart(context, signal);
		}
	}

	async disposeAll(signal?: AbortSignal): Promise<NotebookReleaseResult | undefined> {
		const kernel = this.host.kernel();
		if (!kernel || this.host.activeCellId()) return undefined;
		const names = await this.userBindingNames(kernel, signal);
		if (names.length === 0) return { released: [], disposed: [], failures: [] };
		const marker = lifecycleMarker();
		return parseNotebookRuntimeResult<NotebookReleaseResult>(
			await kernel.execute(notebookDisposeSource(names, marker), { signal }),
			marker,
		);
	}

	private async checkpoint(): Promise<NotebookControlResult> {
		await this.host.checkpoint();
		const details = this.host.metadata().checkpoint;
		return { message: "Notebook checkpoint complete", details };
	}

	private async pin(names: string[], pinned: boolean, hook?: NotebookHook | false): Promise<NotebookControlResult> {
		const activeCell = this.host.activeCellId();
		if (activeCell) throw new Error(`Cannot change notebook pins while exec cell "${activeCell}" is running`);
		const selectedNames = new Set(names);
		const previousToolResultHooks = new Set(this.host.retainedBindings()
			.filter((binding) => selectedNames.has(binding.name) && binding.hook === "tool_result")
			.map(({ name }) => name));
		let rollbackPromotion: (() => Promise<void>) | undefined;
		if (pinned) {
			const kernel = this.host.kernel()!;
			const available = new Set(await this.userBindingNames(kernel));
			const invalid = names.filter((name) => !IDENTIFIER.test(name) || !available.has(name));
			if (invalid.length > 0) throw new Error(`Notebook bindings not found or not pinnable: ${invalid.join(", ")}`);
			rollbackPromotion = await this.host.promoteBindings(names);
		}
		const configureHooks = !pinned || hook !== undefined;
		let hooksConfigured = false;
		try {
			if (configureHooks) {
				await this.configureToolHooks(names, pinned && hook === "tool_result");
				hooksConfigured = true;
			}
			await this.host.checkpoint(undefined, { names, pinned, hook });
		} catch (error) {
			const recoveryFailures: string[] = [];
			if (hooksConfigured) {
				try {
					await this.configureToolHooks(names, false);
					if (previousToolResultHooks.size > 0) await this.configureToolHooks([...previousToolResultHooks], true);
				} catch (recoveryError) {
					recoveryFailures.push(`hook registration: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
				}
			}
			if (rollbackPromotion) {
				try {
					await rollbackPromotion();
				} catch (recoveryError) {
					recoveryFailures.push(`promotion tracking: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
				}
			}
			if (recoveryFailures.length > 0) {
				const reason = error instanceof Error ? error.message : String(error);
				throw new Error(withNotebookRecoveryGuidance(`${reason}. Durable pin and hook metadata was not changed, but notebook runtime recovery failed (${recoveryFailures.join("; ")}); call notebook with ${JSON.stringify({ input: JSON.stringify({ action: "restart" }) })} before retrying`), { cause: error });
			}
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${reason}. Durable pin and hook metadata was not changed${hooksConfigured || rollbackPromotion ? "; transient notebook state was restored" : ""}`, { cause: error });
		}
		const retained = this.host.retainedBindings();
		const reportedNames = withinNameBudget(names);
		const selected = retained.filter((binding) => reportedNames.includes(binding.name));
		const bindings = takeDetailValues(selected, { remaining: NOTEBOOK_DETAILS_BUDGET });
		return {
			message: `${pinned ? "Pinned" : "Unpinned"} durable notebook bindings: ${formatNameList(names)}${hook === undefined ? "" : `; hook ${hook || "removed"}`}`,
			details: { pinned, bindings, bindingCount: names.length, omittedBindings: names.length - bindings.length },
		};
	}

	private async configureToolHooks(names: string[], enabled: boolean): Promise<void> {
		const configured = await this.host.kernel()!.execute(notebookToolHooksSource(names, enabled));
		if (configured.status !== "ok") throw new Error(`Notebook runtime bootstrap unavailable: __piNotebook.configureToolHooks: ${configured.errorText ?? configured.status}`);
	}

	private async release(names: string[], context: ToolExecutionContext, signal?: AbortSignal, preservedNames: string[] = []): Promise<NotebookControlResult> {
		const activeCell = this.host.activeCellId();
		if (activeCell) throw new Error(`Cannot release notebook state while exec cell "${activeCell}" is running; terminate or restart it first`);
		const kernel = this.host.kernel()!;
		const available = new Set(await this.userBindingNames(kernel));
		const invalid = names.filter((name) => !IDENTIFIER.test(name) || !available.has(name));
		if (invalid.length > 0) throw new Error(`Notebook bindings not found or not releasable: ${invalid.join(", ")}`);
		const pinned = new Set(this.host.retainedBindings().filter((binding) => binding.pinned).map(({ name }) => name));
		const protectedNames = names.filter((name) => pinned.has(name));
		if (protectedNames.length > 0) throw new Error(`Pinned notebook bindings cannot be released: ${formatNameList(protectedNames)}; unpin them first`);
		const statusMarker = lifecycleMarker();
		const status = parseNotebookRuntimeResult<NotebookKernelStatus>(
			await kernel.execute(notebookStatusSource(names, statusMarker), { signal }),
			statusMarker,
		);
		const restartRequired = status.bindings.some(({ globalProperty }) => !globalProperty);
		let result: NotebookReleaseResult;
		if (restartRequired) {
			this.host.markChanged();
			await this.host.checkpoint(new Set(names));
			const disposal = await this.disposeAll(signal);
			const extension = context.extensionContext;
			if (!extension) throw new Error("Notebook release requires an extension session context");
			await this.host.restart(extension, signal);
			result = {
				released: [...names],
				disposed: disposal?.disposed ?? [],
				failures: disposal?.failures ?? [],
			};
		} else {
			const marker = lifecycleMarker();
			result = parseNotebookRuntimeResult<NotebookReleaseResult>(
				await kernel.execute(notebookReleaseSource(names, marker), { signal }),
				marker,
			);
			if (result.released.length > 0) {
				this.host.markChanged();
				await this.host.checkpoint(new Set(result.released));
			}
		}
		const remaining = new Set(await this.userBindingNames(this.host.kernel()!));
		for (const name of [...result.released]) {
			if (!remaining.has(name)) continue;
			result.released.splice(result.released.indexOf(name), 1);
			result.failures.push({ name, reason: "concurrent project state retained this binding" });
		}
		const details = boundedReleaseDetails(result, preservedNames, restartRequired, this.host.metadata().checkpoint);
		return { message: formatRelease(result, restartRequired), details };
	}

	private async prune(query: string, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		const kernel = this.host.kernel()!;
		const matches = (await this.userBindingNames(kernel)).filter(globMatcher(query));
		const pinned = new Set(this.host.retainedBindings().filter((binding) => binding.pinned).map(({ name }) => name));
		const protectedNames = matches.filter((name) => pinned.has(name));
		const names = matches.filter((name) => !pinned.has(name));
		if (names.length === 0) {
			const details = boundedReleaseDetails({ released: [], disposed: [], failures: [] }, protectedNames, false, this.host.metadata().checkpoint);
			return {
				message: `No unpinned notebook bindings matched ${JSON.stringify(query)}${protectedNames.length > 0 ? `; protected: ${formatNameList(protectedNames)}` : ""}`,
				details: { ...details, query },
			};
		}
		const released = await this.release(names, context, signal, protectedNames);
		return {
			message: `${released.message}${protectedNames.length > 0 ? `\nPinned matches preserved: ${formatNameList(protectedNames)}` : ""}`,
			details: { ...released.details, query },
		};
	}

	private async restart(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		const activeCell = await this.host.stopActive();
		let checkpointNotice: string | undefined;
		if (!activeCell && this.host.runtimeHealth().state === "ready") {
			try {
				await this.host.checkpoint();
			} catch (error) {
				if (this.host.runtimeHealth().state !== "invalidated") throw error;
				checkpointNotice = `Checkpoint skipped after runtime invalidation: ${error instanceof Error ? error.message : String(error)}`;
			}
		}
		const disposal = await this.disposeAll(signal).catch((error) => ({
			released: [],
			disposed: [],
			failures: [{ name: "notebook", reason: error instanceof Error ? error.message : String(error) }],
		}));
		const extension = context.extensionContext;
		if (!extension) throw new Error("Notebook restart requires an extension session context");
		const restoreNotice = await this.host.restart(extension, signal);
		const details = {
			...(activeCell ? { terminatedCell: activeCell } : {}),
			disposed: disposal?.disposed ?? [],
			disposalFailures: disposal?.failures ?? [],
			...(restoreNotice ? { restoreNotice } : {}),
		};
		return {
			message: [
				`Notebook kernel restarted from the last completed checkpoint${activeCell ? `; terminated ${activeCell}` : ""}`,
				disposal && disposal.failures.length > 0 ? `${disposal.failures.length} resource cleanup failure${disposal.failures.length === 1 ? "" : "s"}; restart continued` : undefined,
				checkpointNotice,
				restoreNotice,
			].filter(Boolean).join(". "),
			details,
		};
	}

	private async userBindingNames(kernel: DenoJupyterKernel, signal?: AbortSignal): Promise<string[]> {
		const baseline = this.host.baselineNames();
		return [...new Set(await kernel.complete("", 0, signal))]
			.filter((name) => IDENTIFIER.test(name) && !baseline.has(name))
			.sort();
	}
}

function lifecycleMarker(): string {
	return `__PI_NOTEBOOK_LIFECYCLE_${randomUUID()}__`;
}
