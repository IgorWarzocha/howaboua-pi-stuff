import type { NotebookMemoryUsage } from "../code-mode/types.ts";
import type { NotebookKernelStatus, NotebookReleaseResult } from "./lifecycle-runtime.ts";
import type { RetainedProjectBinding } from "./project-state-metadata.ts";

const INSPECTION_NAME_BUDGET = 16 * 1024;
const MESSAGE_BUDGET = 16 * 1024;
export const NOTEBOOK_DETAILS_BUDGET = 16 * 1024;

export interface NotebookStatusDetails extends Record<string, unknown> {
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
		description?: string | undefined;
		usage?: string | undefined;
	}> | undefined;
	omittedMatches?: number | undefined;
	retainedBindings: number;
	retainedBytes: number;
	pinnedBindings: number;
	pinned: RetainedProjectBinding[];
	omittedPinned: number;
	largestUnpinned: RetainedProjectBinding[];
	omittedLargestUnpinned: number;
}

export function withinNameBudget(names: string[]): string[] {
	let bytes = 0;
	return names.filter((name) => {
		bytes += Buffer.byteLength(name) + 1;
		return bytes <= INSPECTION_NAME_BUDGET;
	});
}

export function formatNameList(names: string[]): string {
	const shown = withinNameBudget(names);
	const suffix = names.length > shown.length ? `, and ${names.length - shown.length} more` : "";
	return `${shown.join(", ")}${suffix}`;
}

export function takeDetailValues<T>(values: T[], budget: { remaining: number }): T[] {
	const selected: T[] = [];
	for (const value of values) {
		const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
		if (bytes > budget.remaining) break;
		budget.remaining -= bytes;
		selected.push(value);
	}
	return selected;
}

export function remainingDetailsBudget(base: unknown): { remaining: number } {
	return { remaining: Math.max(0, NOTEBOOK_DETAILS_BUDGET - Buffer.byteLength(JSON.stringify(base))) };
}

export function boundedReleaseDetails(
	result: NotebookReleaseResult,
	protectedNames: string[],
	restarted: boolean,
	checkpoint: Record<string, unknown>,
): Record<string, unknown> {
	const budget = { remaining: NOTEBOOK_DETAILS_BUDGET };
	const protectedBindings = takeDetailValues(protectedNames, budget);
	const released = takeDetailValues(result.released, budget);
	const disposed = takeDetailValues(result.disposed, budget);
	const failures = takeDetailValues(result.failures, budget);
	return {
		restarted,
		checkpoint,
		protected: protectedBindings,
		protectedCount: protectedNames.length,
		released,
		releasedCount: result.released.length,
		disposed,
		disposedCount: result.disposed.length,
		failures,
		failureCount: result.failures.length,
	};
}

export function formatStatus(details: NotebookStatusDetails): string {
	const memory = details.memory;
	const checkpoint = details.checkpoint;
	const lines = [
		`Notebook ${details.state}${details.activeCell ? ` (${details.activeCell})` : ""} · ${details.userCells} completed cell${details.userCells === 1 ? "" : "s"}`,
		memory ? `Memory ${formatBytes(memory.heapUsedBytes)} heap used / ${formatBytes(memory.heapLimitBytes)} limit · ${formatBytes(memory.rssBytes)} RSS` : undefined,
		`Checkpoint ${checkpoint["dirty"] ? "pending" : "current"} · project generation ${String(checkpoint["projectGeneration"] ?? "root")} · ${String(checkpoint["projectBindings"] ?? 0)} durable binding(s)`,
		`Retained state ${details.retainedBindings} binding(s) · ${formatBytes(details.retainedBytes)} serialized · ${details.pinnedBindings} pinned`,
		details.userBindings === undefined ? undefined : `Top-level bindings: ${details.userBindings}`,
	];
	if (details.query === undefined && details.pinned.length > 0) {
		lines.push("Pinned project bindings:");
		for (const binding of details.pinned) lines.push(`- ${binding.name}: ${formatBytes(binding.bytes)} · updated ${formatAge(binding.updatedAt)}${formatBindingMetadata(binding)}`);
		if (details.omittedPinned > 0) lines.push(`${details.omittedPinned} additional pinned binding(s) omitted; use status with a query glob`);
	}
	if (details.query === undefined && (details.largestUnpinned.length > 0 || details.omittedLargestUnpinned > 0)) {
		if (details.largestUnpinned.length > 0) {
			lines.push("Largest unpinned retained bindings:");
			for (const binding of details.largestUnpinned) {
				lines.push(`- ${binding.name}: ${formatBytes(binding.bytes)} · updated ${formatAge(binding.updatedAt)}${formatBindingMetadata(binding)}`);
			}
		}
		if (details.omittedLargestUnpinned > 0) lines.push(`${details.omittedLargestUnpinned} additional unpinned binding(s) omitted; use status with a query glob`);
		lines.push("Use status with a query glob for details; unpinned state is reusable scratch, pin valuable state before pruning");
	}
	if (details.query !== undefined) {
		lines.push(`Bindings matching ${JSON.stringify(details.query)}:`);
		for (const binding of details.matches ?? []) {
			lines.push(`- ${binding.name}: ${binding.kind}${binding.constructor ? ` ${binding.constructor}` : ` ${binding.type}`}${binding.disposable ? ` · ${binding.disposable} disposable` : ""}${binding.bytes === undefined ? "" : ` · ${formatBytes(binding.bytes)} · updated ${formatAge(binding.updatedAt!)}`}${binding.pinned ? " · pinned" : ""}${formatBindingMetadata(binding)}`);
		}
		if ((details.matches?.length ?? 0) === 0) lines.push("- none");
		if ((details.omittedMatches ?? 0) > 0) lines.push(`${details.omittedMatches} additional match(es) omitted; narrow query`);
	}
	return boundMessage(lines.filter(Boolean).join("\n"));
}

function formatBindingMetadata(binding: { description?: string | undefined; usage?: string | undefined }): string {
	const description = binding.description === undefined ? "" : ` · ${binding.description}`;
	const usage = binding.usage === undefined ? "" : ` · usage: ${binding.usage.replaceAll("\n", "\n  ")}`;
	return `${description}${usage}`;
}

export function formatRelease(result: NotebookReleaseResult, restarted: boolean): string {
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
