import type { KernelExecutionResult } from "./jupyter-kernel.ts";
import type { RuntimeContentItem, ToolExecutionContext } from "../code-mode/types.ts";

const MAX_CELL_OUTPUT_CHARS = 32 * 1024 * 1024;
const MAX_CELL_OUTPUT_ITEMS = 10_000;

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

export class NotebookCell {
	readonly id: string;
	readonly source: string;
	readonly controller = new AbortController();
	readonly items: RuntimeContentItem[] = [];
	readonly maxOutputTokens: number;
	context: ToolExecutionContext;
	result?: KernelExecutionResult | undefined;
	terminated = false;
	private outputChars = 0;
	private outputTruncated = false;
	private cursor = 0;
	private completedValue = false;
	private yielded = deferred();
	private blockersChanged = deferred();
	private readonly blockers = new Set<string>();
	private readonly completed = deferred();

	constructor(options: {
		id: string;
		source: string;
		context: ToolExecutionContext;
		maxOutputTokens: number;
	}) {
		this.id = options.id;
		this.source = options.source;
		this.context = options.context;
		this.maxOutputTokens = options.maxOutputTokens;
	}

	async observe(yieldTimeMs: number, signal?: AbortSignal): Promise<"result" | "yielded"> {
		signal?.throwIfAborted();
		while (!this.result) {
			const blockersChanged = this.blockersChanged.promise;
			const blocked = this.blockers.size > 0;
			await waitForObservation([
				this.completed.promise,
				blockersChanged,
				...(blocked ? [] : [this.yielded.promise]),
			], blocked ? undefined : yieldTimeMs, signal);
			if (this.result) return "result";
			if (this.blockersChanged.promise !== blockersChanged) continue;
			if (this.blockers.size > 0) {
				this.yielded = deferred();
				continue;
			}
			this.yielded = deferred();
			return "yielded";
		}
		return "result";
	}

	markCompleted(): void {
		this.completedValue = true;
		this.completed.resolve();
	}

	isCompleted(): boolean {
		return this.completedValue;
	}

	waitForCompletion(): Promise<void> {
		return this.completed.promise;
	}

	requestYield(): void {
		this.yielded.resolve();
	}

	setBlocked(blockerId: string, active: boolean): void {
		const changed = active ? !this.blockers.has(blockerId) : this.blockers.delete(blockerId);
		if (active) this.blockers.add(blockerId);
		if (!changed) return;
		if (active) this.yielded = deferred();
		this.blockersChanged.resolve();
		this.blockersChanged = deferred();
	}

	takeContent(): RuntimeContentItem[] {
		const content = this.items.slice(this.cursor);
		this.cursor = this.items.length;
		return content;
	}

	emit(items: RuntimeContentItem[]): void {
		const accepted: RuntimeContentItem[] = [];
		for (const item of items) {
			if (this.outputTruncated) break;
			const size = item.type === "input_text" ? item.text?.length ?? 0 : item.image_url?.length ?? 0;
			if (this.items.length >= MAX_CELL_OUTPUT_ITEMS || this.outputChars + size > MAX_CELL_OUTPUT_CHARS) {
				const notice = { type: "input_text" as const, text: "[Notebook cell output truncated]" };
				this.items.push(notice);
				accepted.push(notice);
				this.outputChars += notice.text.length;
				this.outputTruncated = true;
				break;
			}
			this.items.push(item);
			accepted.push(item);
			this.outputChars += size;
		}
		const content: Array<
			| { type: "text"; text: string }
			| { type: "image"; mimeType: string; data: string }
		> = [];
		for (const item of accepted) {
			if (item.type === "input_text" && item.text) {
				content.push({ type: "text", text: item.text });
				continue;
			}
			const match = item.type === "input_image" && item.image_url?.match(/^data:([^;,]+);base64,(.+)$/s);
			if (match) content.push({ type: "image", mimeType: match[1]!, data: match[2]! });
		}
		if (content.length > 0) this.context.onUpdate?.({ content, details: { cellId: this.id, status: "running" } });
	}
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function waitForObservation(
	promises: Promise<void>[],
	timeoutMs: number | undefined,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted)
		return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const abort = () =>
			finish(signal?.reason ?? new Error("Operation aborted"));
		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (error === undefined) resolve();
			else reject(error);
		};
		for (const promise of promises)
			void promise.then(() => finish(), (error) => finish(error));
		if (timeoutMs !== undefined)
			timer = setTimeout(() => finish(), Math.max(0, timeoutMs));
		signal?.addEventListener("abort", abort, { once: true });
	});
}
