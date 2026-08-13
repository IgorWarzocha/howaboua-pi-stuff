import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	NotebookControlRequest,
	NotebookControlResult,
	NotebookMemoryUsage,
	ToolExecutionContext,
} from "../code-mode/types.ts";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";
import { globMatcher } from "./glob.ts";
import type { RetainedProjectBinding } from "./project-state-metadata.ts";
import {
	notebookDisposeSource,
	notebookReleaseSource,
	notebookStatusSource,
	parseNotebookRuntimeResult,
	type NotebookKernelStatus,
	type NotebookReleaseResult,
} from "./lifecycle-runtime.ts";
import { NotebookProfileController } from "./profile-lifecycle.ts";

const INSPECTION_NAME_BUDGET = 16 * 1024;
const MESSAGE_BUDGET = 16 * 1024;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

interface NotebookLifecycleHost {
	prepare(context: ToolExecutionContext, signal?: AbortSignal): Promise<void>;
	diagnostics(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult>;
	reset(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult>;
	kernel(): DenoJupyterKernel | undefined;
	activeCellId(): string | undefined;
	stopActive(): Promise<string | undefined>;
	checkpoint(excludeNames?: ReadonlySet<string>): Promise<void>;
	retainedBindings(): RetainedProjectBinding[];
	setPins(names: string[], pinned: boolean): Promise<RetainedProjectBinding[]>;
	markChanged(): void;
	restart(context: ExtensionContext, signal?: AbortSignal): Promise<string | undefined>;
	rollback(context: ExtensionContext): Promise<void>;
	baselineNames(): ReadonlySet<string>;
	profileStorage(): { agentDir: string; maxBytes: number };
	metadata(): {
		startedAt?: number | undefined;
		userCells: number;
		memory?: NotebookMemoryUsage | undefined;
		checkpoint: Record<string, unknown>;
	};
}

interface NotebookStatusDetails extends Record<string, unknown> {
	state: "idle" | "running";
	activeCell?: string | undefined;
	userBindings?: number | undefined;
	userCells: number;
	startedAt?: string | undefined;
	memory?: NotebookKernelStatus["memory"] | NotebookMemoryUsage | undefined;
	checkpoint: Record<string, unknown>;
	query?: string | undefined;
	matches?: Array<NotebookKernelStatus["bindings"][number] & {
		bytes?: number | undefined;
		updatedAt?: string | undefined;
		pinned?: boolean | undefined;
	}> | undefined;
	omittedMatches?: number | undefined;
	retainedBindings: number;
	retainedBytes: number;
	pinnedBindings: number;
	largestUnpinned: RetainedProjectBinding[];
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
		await this.host.prepare(context, signal);
		switch (request.action) {
			case "status": return this.status(request.query, signal);
			case "checkpoint": return this.checkpoint();
			case "save": return this.profiles.save(request.name, context, signal);
			case "load": return this.profiles.load(request.name, context, signal);
			case "pin": return this.pin(request.names, true);
			case "unpin": return this.pin(request.names, false);
			case "release": return this.release(request.names, context, signal);
			case "prune": return this.prune(request.query, context, signal);
			case "restart": return this.restart(context, signal);
		}
	}

	async disposeAll(signal?: AbortSignal): Promise<NotebookReleaseResult | undefined> {
		const kernel = this.host.kernel();
		if (!kernel || this.host.activeCellId()) return undefined;
		const names = await this.userBindingNames(kernel);
		if (names.length === 0) return { released: [], disposed: [], failures: [] };
		const marker = lifecycleMarker();
		return parseNotebookRuntimeResult<NotebookReleaseResult>(
			await kernel.execute(notebookDisposeSource(names, marker), { signal }),
			marker,
		);
	}

	private async status(query: string | undefined, signal?: AbortSignal): Promise<NotebookControlResult> {
		const kernel = this.host.kernel()!;
		const activeCell = this.host.activeCellId();
		const allNames = activeCell ? [] : await this.userBindingNames(kernel);
		const matches = query === undefined ? [] : allNames.filter(globMatcher(query));
		const selected = withinNameBudget(matches);
		const retained = this.host.retainedBindings();
		const retainedByName = new Map(retained.map((binding) => [binding.name, binding]));
		let runtime: NotebookKernelStatus | undefined;
		if (!activeCell) {
			const marker = lifecycleMarker();
			runtime = parseNotebookRuntimeResult<NotebookKernelStatus>(
				await kernel.execute(notebookStatusSource(selected, marker), { signal }),
				marker,
			);
		}
		const metadata = this.host.metadata();
		const details: NotebookStatusDetails = {
			state: activeCell ? "running" : "idle",
			...(activeCell ? { activeCell } : {}),
			userBindings: activeCell ? undefined : allNames.length,
			userCells: metadata.userCells,
			...(metadata.startedAt ? { startedAt: new Date(metadata.startedAt).toISOString() } : {}),
			memory: runtime?.memory ?? metadata.memory,
			checkpoint: metadata.checkpoint,
			retainedBindings: retained.length,
			retainedBytes: retained.reduce((total, binding) => total + binding.bytes, 0),
			pinnedBindings: retained.filter(({ pinned }) => pinned).length,
			largestUnpinned: retained
				.filter(({ pinned }) => !pinned)
				.sort((left, right) => right.bytes - left.bytes)
				.slice(0, 8),
			...(query === undefined ? {} : {
				query,
				matches: (runtime?.bindings ?? []).map((binding) => {
					const retainedBinding = retainedByName.get(binding.name);
					return {
						...binding,
						...(retainedBinding ? {
							bytes: retainedBinding.bytes,
							updatedAt: retainedBinding.updatedAt,
							pinned: retainedBinding.pinned,
						} : {}),
					};
				}),
				omittedMatches: Math.max(0, matches.length - selected.length),
			}),
		};
		return { message: formatStatus(details), details };
	}

	private async checkpoint(): Promise<NotebookControlResult> {
		await this.host.checkpoint();
		const details = this.host.metadata().checkpoint;
		return { message: "Notebook checkpoint complete", details };
	}

	private async pin(names: string[], pinned: boolean): Promise<NotebookControlResult> {
		const activeCell = this.host.activeCellId();
		if (activeCell) throw new Error(`Cannot change notebook pins while exec cell "${activeCell}" is running`);
		await this.host.checkpoint();
		const retained = await this.host.setPins(names, pinned);
		const reportedNames = withinNameBudget(names);
		const selected = retained.filter((binding) => reportedNames.includes(binding.name));
		return {
			message: `${pinned ? "Pinned" : "Unpinned"} durable notebook bindings: ${formatNameList(names)}`,
			details: { pinned, bindings: selected, omittedBindings: names.length - selected.length },
		};
	}

	private async release(names: string[], context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
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
		const details = { ...result, restarted: restartRequired, checkpoint: this.host.metadata().checkpoint };
		return { message: formatRelease(result, restartRequired), details };
	}

	private async prune(query: string, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		const kernel = this.host.kernel()!;
		const matches = (await this.userBindingNames(kernel)).filter(globMatcher(query));
		const pinned = new Set(this.host.retainedBindings().filter((binding) => binding.pinned).map(({ name }) => name));
		const protectedNames = matches.filter((name) => pinned.has(name));
		const names = matches.filter((name) => !pinned.has(name));
		if (names.length === 0) {
			return {
				message: `No unpinned notebook bindings matched ${JSON.stringify(query)}${protectedNames.length > 0 ? `; protected: ${formatNameList(protectedNames)}` : ""}`,
				details: { query, released: [], protected: protectedNames },
			};
		}
		const released = await this.release(names, context, signal);
		return {
			message: `${released.message}${protectedNames.length > 0 ? `\nPinned matches preserved: ${formatNameList(protectedNames)}` : ""}`,
			details: { ...released.details, query, protected: protectedNames },
		};
	}

	private async restart(context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		const activeCell = await this.host.stopActive();
		if (!activeCell) await this.host.checkpoint();
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
				restoreNotice,
			].filter(Boolean).join(". "),
			details,
		};
	}

	private async userBindingNames(kernel: DenoJupyterKernel): Promise<string[]> {
		const baseline = this.host.baselineNames();
		return [...new Set(await kernel.complete("", 0))]
			.filter((name) => IDENTIFIER.test(name) && !baseline.has(name))
			.sort();
	}
}

function lifecycleMarker(): string {
	return `__PI_NOTEBOOK_LIFECYCLE_${randomUUID()}__`;
}

function withinNameBudget(names: string[]): string[] {
	let bytes = 0;
	return names.filter((name) => {
		bytes += Buffer.byteLength(name) + 1;
		return bytes <= INSPECTION_NAME_BUDGET;
	});
}

function formatNameList(names: string[]): string {
	const shown = withinNameBudget(names);
	const suffix = names.length > shown.length ? `, and ${names.length - shown.length} more` : "";
	return `${shown.join(", ")}${suffix}`;
}

function formatStatus(details: NotebookStatusDetails): string {
	const memory = details.memory;
	const checkpoint = details.checkpoint;
	const lines = [
		`Notebook ${details.state}${details.activeCell ? ` (${details.activeCell})` : ""} · ${details.userCells} completed cell${details.userCells === 1 ? "" : "s"}`,
		memory ? `Memory ${formatBytes(memory.heapUsedBytes)} heap used / ${formatBytes(memory.heapLimitBytes)} limit · ${formatBytes(memory.rssBytes)} RSS` : undefined,
		`Checkpoint ${checkpoint["dirty"] ? "pending" : "current"} · project generation ${String(checkpoint["projectGeneration"] ?? "root")} · ${String(checkpoint["projectBindings"] ?? 0)} durable binding(s)`,
		`Retained state ${details.retainedBindings} binding(s) · ${formatBytes(details.retainedBytes)} serialized · ${details.pinnedBindings} pinned`,
		details.userBindings === undefined ? undefined : `Top-level bindings: ${details.userBindings}`,
	];
	if (details.query === undefined && details.largestUnpinned.length > 0) {
		lines.push("Largest unpinned retained bindings:");
		for (const binding of details.largestUnpinned) {
			lines.push(`- ${binding.name}: ${formatBytes(binding.bytes)} · updated ${formatAge(binding.updatedAt)}`);
		}
		lines.push("Use status with a query glob for details; pin intentional state before pruning disposable matches");
	}
	if (details.query !== undefined) {
		lines.push(`Bindings matching ${JSON.stringify(details.query)}:`);
		for (const binding of details.matches ?? []) {
			lines.push(`- ${binding.name}: ${binding.kind}${binding.constructor ? ` ${binding.constructor}` : ` ${binding.type}`}${binding.disposable ? ` · ${binding.disposable} disposable` : ""}${binding.bytes === undefined ? "" : ` · ${formatBytes(binding.bytes)} · updated ${formatAge(binding.updatedAt!)}`}${binding.pinned ? " · pinned" : ""}`);
		}
		if ((details.matches?.length ?? 0) === 0) lines.push("- none");
		if ((details.omittedMatches ?? 0) > 0) lines.push(`${details.omittedMatches} additional match(es) omitted; narrow query`);
	}
	return boundMessage(lines.filter(Boolean).join("\n"));
}

function formatRelease(result: NotebookReleaseResult, restarted: boolean): string {
	const lines = [
		`Released notebook bindings: ${result.released.length > 0 ? result.released.join(", ") : "none"}`,
		restarted ? "Kernel restarted to clear lexical bindings; durable state was restored and runtime-only handles were not" : undefined,
		result.disposed.length > 0 ? `Disposed standard resources: ${result.disposed.join(", ")}` : undefined,
		...result.failures.map(({ name, reason }) => `Failed ${name}: ${reason}`),
	];
	return boundMessage(lines.filter(Boolean).join("\n"));
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function formatAge(timestamp: string): string {
	const elapsed = Math.max(0, Date.now() - Date.parse(timestamp));
	if (elapsed < 60_000) return "just now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
	return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function boundMessage(message: string): string {
	const marker = "\n[Notebook lifecycle output truncated; narrow query]";
	return message.length <= MESSAGE_BUDGET ? message : `${message.slice(0, MESSAGE_BUDGET - marker.length)}${marker}`;
}
