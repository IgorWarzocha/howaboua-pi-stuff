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
	kernel(): DenoJupyterKernel | undefined;
	activeCellId(): string | undefined;
	stopActive(): Promise<string | undefined>;
	checkpoint(excludeNames?: ReadonlySet<string>): Promise<void>;
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
	matches?: NotebookKernelStatus["bindings"] | undefined;
	omittedMatches?: number | undefined;
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
		await this.host.prepare(context, signal);
		switch (request.action) {
			case "status": return this.status(request.query, signal);
			case "checkpoint": return this.checkpoint();
			case "save": return this.profiles.save(request.name, context, signal);
			case "load": return this.profiles.load(request.name, context, signal);
			case "release": return this.release(request.names, context, signal);
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
			...(query === undefined ? {} : {
				query,
				matches: runtime?.bindings ?? [],
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

	private async release(names: string[], context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult> {
		const activeCell = this.host.activeCellId();
		if (activeCell) throw new Error(`Cannot release notebook state while exec cell "${activeCell}" is running; terminate or restart it first`);
		const kernel = this.host.kernel()!;
		const available = new Set(await this.userBindingNames(kernel));
		const invalid = names.filter((name) => !IDENTIFIER.test(name) || !available.has(name));
		if (invalid.length > 0) throw new Error(`Notebook bindings not found or not releasable: ${invalid.join(", ")}`);
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

function formatStatus(details: NotebookStatusDetails): string {
	const memory = details.memory;
	const checkpoint = details.checkpoint;
	const lines = [
		`Notebook ${details.state}${details.activeCell ? ` (${details.activeCell})` : ""} · ${details.userCells} completed cell${details.userCells === 1 ? "" : "s"}`,
		memory ? `Memory ${formatBytes(memory.heapUsedBytes)} heap used / ${formatBytes(memory.heapLimitBytes)} limit · ${formatBytes(memory.rssBytes)} RSS` : undefined,
		`Checkpoint ${checkpoint["dirty"] ? "pending" : "current"} · project generation ${String(checkpoint["projectGeneration"] ?? "root")} · ${String(checkpoint["projectBindings"] ?? 0)} durable binding(s)`,
		details.userBindings === undefined ? undefined : `Top-level bindings: ${details.userBindings}`,
	];
	if (details.query !== undefined) {
		lines.push(`Bindings matching ${JSON.stringify(details.query)}:`);
		for (const binding of details.matches ?? []) {
			lines.push(`- ${binding.name}: ${binding.kind}${binding.constructor ? ` ${binding.constructor}` : ` ${binding.type}`}${binding.disposable ? ` · ${binding.disposable} disposable` : ""}`);
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

function boundMessage(message: string): string {
	const marker = "\n[Notebook lifecycle output truncated; narrow query]";
	return message.length <= MESSAGE_BUDGET ? message : `${message.slice(0, MESSAGE_BUDGET - marker.length)}${marker}`;
}
