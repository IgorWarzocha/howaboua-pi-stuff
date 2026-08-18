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
		if (!this.result) {
			await Promise.race([
				this.completed.promise,
				this.yielded.promise,
				abortableDelay(yieldTimeMs, signal),
			]);
		}
		if (this.result) return "result";
		this.yielded = deferred();
		return "yielded";
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

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(finish, Math.max(0, ms));
		const abort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			reject(signal?.reason ?? new Error("Operation aborted"));
		};
		function finish() {
			signal?.removeEventListener("abort", abort);
			resolve();
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}
