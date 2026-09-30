import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

type ExecuteTool = ExtensionToolContext["executeTool"];

/** Pi retires nested-call IDs when the outer result returns. Drain calls before
 * returning a yield; later calls wait for the next exec/wait observation. */
export class PiToolCallScope {
	private accepting = true;
	private readonly pending = new Set<ReturnType<ExecuteTool>>();
	private readonly context: ExtensionToolContext;
	private readonly signal: AbortSignal | undefined;

	constructor(context: ExtensionToolContext, signal?: AbortSignal) {
		this.context = context;
		this.signal = signal;
	}

	run(...[name, args, options]: Parameters<ExecuteTool>): ReturnType<ExecuteTool> | undefined {
		if (!this.accepting) return undefined;
		if (typeof this.context.executeTool !== "function")
			throw new Error("MCP calls require Pi's nested tool executor");
		const signals = [this.signal, options?.signal].filter((signal): signal is AbortSignal => Boolean(signal));
		const pending = this.context.executeTool(name, args, {
			...options,
			...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
		}).finally(() => this.pending.delete(pending));
		this.pending.add(pending);
		return pending;
	}

	async close(): Promise<void> {
		this.accepting = false;
		await Promise.allSettled(this.pending);
	}
}
