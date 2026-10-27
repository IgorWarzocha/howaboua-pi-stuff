import type { CodeModeToolDefinition, ToolExecutionContext } from "../types.ts";

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

export class DelegateCellScheduling {
	private readonly cellContexts = new Map<string, ToolExecutionContext>();
	private readonly contextChanges = new Map<string, Deferred>();
	private readonly cellTools = new Map<string, Map<string, CodeModeToolDefinition>>();
	private readonly blockers = new Map<string, Set<string>>();
	private readonly blockerChanges = new Map<string, Deferred>();
	private readonly sequentialTails = new Map<string, Promise<void>>();

	context(cellId: string): ToolExecutionContext | undefined { return this.cellContexts.get(cellId); }
	tools(cellId: string): Map<string, CodeModeToolDefinition> | undefined { return this.cellTools.get(cellId); }
	bindTools(cellId: string, tools: Map<string, CodeModeToolDefinition>): void { this.cellTools.set(cellId, tools); }

	updateCellContext(cellId: string, context: ToolExecutionContext): void {
		const previous = this.cellContexts.get(cellId);
		if (previous?.opaqueScope && (previous.opaqueScope !== context.opaqueScope ||
			previous.opaqueContextGeneration !== context.opaqueContextGeneration))
			throw new Error("Remote cell belongs to a different context; check completed results before retrying");
		this.cellContexts.set(cellId, context);
		this.contextChanges.get(cellId)?.resolve();
		this.contextChanges.delete(cellId);
	}

	closeCell(cellId: string): void {
		this.cellContexts.delete(cellId);
		this.contextChanges.get(cellId)?.resolve();
		this.contextChanges.delete(cellId);
		this.cellTools.delete(cellId);
		this.blockers.delete(cellId);
		this.blockerChanges.get(cellId)?.resolve();
		this.blockerChanges.delete(cellId);
		this.sequentialTails.delete(cellId);
	}
	clear(): void {
		this.cellContexts.clear();
		for (const change of this.contextChanges.values()) change.resolve();
		this.contextChanges.clear();
		this.cellTools.clear();
		for (const change of this.blockerChanges.values()) change.resolve();
		this.blockers.clear();
		this.blockerChanges.clear();
		this.sequentialTails.clear();
	}
	isBlocked(cellId: string): boolean {
		return (this.blockers.get(cellId)?.size ?? 0) > 0;
	}

	async waitUntilUnblocked(cellId: string, signal?: AbortSignal): Promise<void> {
		while (this.isBlocked(cellId)) {
			const change = this.blockerChanges.get(cellId) ?? deferred();
			this.blockerChanges.set(cellId, change);
			await waitForChange(change.promise, signal);
		}
	}
	async executePiTool(
		cellId: string,
		...[name, args, options]: Parameters<NonNullable<ToolExecutionContext["executeTool"]>>
	): ReturnType<NonNullable<ToolExecutionContext["executeTool"]>> {
		while (true) {
			options?.signal?.throwIfAborted();
			const scope = this.cellContexts.get(cellId)?.piToolScope;
			if (!scope) throw new Error("Pi nested tool call context is unavailable");
			const pending = scope.run(name, args, options);
			if (pending) return pending;
			const change = this.contextChanges.get(cellId) ?? deferred();
			this.contextChanges.set(cellId, change);
			await waitForChange(change.promise, options?.signal);
		}
	}
	async invokeSequential(
		cellId: string,
		signal: AbortSignal,
		run: () => Promise<unknown>,
	): Promise<unknown> {
		let release: () => void;
		const turn = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = this.sequentialTails.get(cellId) ?? Promise.resolve();
		this.sequentialTails.set(cellId, previous.then(() => turn));
		try {
			await waitForChange(previous, signal);
			return await run();
		} finally {
			release!();
		}
	}

	setBlocked(
		cellId: string,
		blockerId: string,
		active: boolean,
	): void {
		const blockers = this.blockers.get(cellId) ?? new Set<string>();
		const changed = active ? !blockers.has(blockerId) : blockers.delete(blockerId);
		if (active) blockers.add(blockerId);
		if (!changed) return;
		if (blockers.size === 0) this.blockers.delete(cellId);
		else this.blockers.set(cellId, blockers);
		this.cellContexts.get(cellId)?.setBlocked?.(blockerId, active);
		this.blockerChanges.get(cellId)?.resolve();
		this.blockerChanges.set(cellId, deferred());
	}
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function waitForChange(change: Promise<void>, signal?: AbortSignal): Promise<void> {
	if (!signal) return change;
	if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason ?? new Error("Operation aborted"));
		signal.addEventListener("abort", abort, { once: true });
		void change.then(
			() => {
				signal.removeEventListener("abort", abort);
				resolve();
			},
			(error: unknown) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
