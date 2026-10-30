import { setImmediate } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import type {
	PruneResult,
	SearchItem,
	SearchRequest,
	SearchResponse,
} from "./history-search-protocol.js";

const UNAVAILABLE =
	"Ranked history search is unavailable. list and read still work. Ask the user to check local storage or turn off Ranked history search in /notes.";

/** Worker owns derived storage; JSONL and the caller own content and scope. */
export class HistorySearch {
	private worker: Worker | undefined;
	private sessionId: string | undefined;
	private file: string | undefined;
	private sequence = 0;
	private indexed = new Map<string, SearchItem>();
	private excluded = new Set<string>();
	private indexing: Promise<void> | undefined;
	private generation = 0;
	private pending = new Map<
		number,
		{
			resolve: (value: string[] | PruneResult | null) => void;
			reject: (error: Error) => void;
		}
	>();
	private readonly path: string;
	constructor(path: string) {
		this.path = path;
	}

	setSession(sessionId: string | undefined, file?: string): boolean {
		if (sessionId === this.sessionId) {
			this.file = file ?? this.file;
			return false;
		}
		this.close();
		this.sessionId = sessionId;
		this.file = file;
		return true;
	}

	isEnabled(sessionId: string): boolean {
		return this.sessionId === sessionId;
	}

	private start(): Worker {
		if (this.worker) return this.worker;
		// Workers run outside jiti. Checked JavaScript also works when the
		// published source package is installed beneath node_modules.
		const worker = new Worker(
			new URL("./history-search-worker.mjs", import.meta.url),
			{
				workerData: { path: this.path },
				execArgv: [],
			},
		);
		this.worker = worker;
		worker.on("message", (response: SearchResponse) => {
			if (worker !== this.worker) return;
			const pending = this.pending.get(response.id);
			if (!pending) return;
			this.pending.delete(response.id);
			if ("error" in response) {
				const error = new Error(UNAVAILABLE, { cause: response.error });
				pending.reject(error);
				this.stop(error);
			} else pending.resolve(response.value);
			if (!this.pending.size) worker.unref();
		});
		const failed = (cause: unknown) => {
			if (worker !== this.worker) return;
			this.stop(new Error(UNAVAILABLE, { cause }));
		};
		worker.on("error", failed);
		worker.on("exit", (code) =>
			failed(new Error(`History worker exited (${code})`)),
		);
		return worker;
	}

	private request(
		request: SearchRequest,
		signal?: AbortSignal,
	): Promise<string[] | PruneResult | null> {
		signal?.throwIfAborted();
		return new Promise((resolve, reject) => {
			const id = ++this.sequence;
			const abort = () => {
				// SQLite is synchronous inside the worker. Termination is the only
				// cancellation that also stops CPU/IO and rolls back its transaction.
				this.stop(
					new Error("History search cancelled; retry the query", {
						cause: signal?.reason,
					}),
				);
			};
			const finish = () => signal?.removeEventListener("abort", abort);
			try {
				const worker = this.start();
				this.pending.set(id, {
					resolve: (value) => {
						finish();
						resolve(value);
					},
					reject: (error) => {
						finish();
						reject(error);
					},
				});
				signal?.addEventListener("abort", abort, { once: true });
				worker.ref();
				worker.postMessage({ id, request });
			} catch (cause) {
				finish();
				this.pending.delete(id);
				reject(new Error(UNAVAILABLE, { cause }));
			}
		});
	}

	async index(
		sessionId: string,
		items: readonly SearchItem[],
		signal?: AbortSignal,
		excludedIds?: readonly string[],
	): Promise<void> {
		signal?.throwIfAborted();
		if (!this.isEnabled(sessionId)) return;
		const removeIds = excludedIds?.filter((id) => !this.excluded.has(id)) ?? [];
		if (excludedIds) this.excluded = new Set(excludedIds);
		for (const id of removeIds) this.indexed.delete(id);
		const changed = items.filter((item) => {
			const existing = this.indexed.get(item.item_id);
			return (
				!existing || (existing !== item && existing.content !== item.content)
			);
		});
		if (!changed.length && !removeIds.length) {
			// Cache hits still yield: consecutive tool turns must not monopolize
			// the UI through an uninterrupted chain of resolved promises.
			await (this.indexing ?? setImmediate());
			return;
		}
		for (const item of changed) this.indexed.set(item.item_id, item);
		const generation = this.generation;
		const previous = this.indexing;
		const work = (async () => {
			await previous;
			let offset = 0;
			do {
				if (generation !== this.generation)
					throw new Error("History session changed; retry the query");
				// Bound structured-clone stalls as well as worker work. The next
				// batch waits for completion; searches await the whole index fence.
				const batch: SearchItem[] = [];
				let chars = 0;
				while (
					offset < changed.length &&
					batch.length < 128 &&
					chars < 1_000_000
				) {
					const item = changed[offset++]!;
					batch.push({ item_id: item.item_id, content: item.content });
					chars += item.content.length;
				}
				await this.request(
					{
						action: "index",
						sessionId,
						file: this.file,
						items: batch,
						removeIds: offset <= batch.length ? removeIds : [],
					},
					signal,
				);
			} while (offset < changed.length);
		})();
		this.indexing = work;
		try {
			await work;
		} catch (error) {
			if (generation === this.generation)
				this.stop(
					error instanceof Error
						? error
						: new Error("History indexing failed", { cause: error }),
				);
			throw error;
		} finally {
			if (this.indexing === work) this.indexing = undefined;
		}
	}

	async search<T extends SearchItem>(
		sessionId: string,
		items: readonly T[],
		query: string,
		limit: number,
		recentFirst: boolean,
		signal?: AbortSignal,
	): Promise<T[]> {
		if (!this.isEnabled(sessionId))
			throw new Error("Ranked history search is not enabled for this session");
		const words = [
			...new Set(query.toLowerCase().match(/[\p{L}\p{N}\p{M}\p{Co}]+/gu)),
		];
		if (!words.length)
			throw new Error("Supply at least one word or number to search history");
		if (!items.length) return [];
		const session = this.sessionId;
		await this.index(sessionId, items, signal);
		signal?.throwIfAborted();
		if (session !== this.sessionId)
			throw new Error("History session changed; retry the query");
		const ids = await this.request(
			{
				action: "search",
				sessionId,
				ids: items.map((item) => item.item_id),
				match: words.map((word) => `"${word}"`).join(" AND "),
				limit,
				recentFirst,
			},
			signal,
		);
		if (!Array.isArray(ids)) throw new Error(UNAVAILABLE);
		const scope = new Map(items.map((item) => [item.item_id, item]));
		return ids.map((id) => scope.get(id)!);
	}

	async pruneSession(sessionId: string, file: string): Promise<void> {
		await this.request({ action: "prune_session", sessionId, file });
	}

	async prune(
		activeSessionId: string,
		sources: Record<string, string | null> = {},
	): Promise<PruneResult> {
		const result = await this.request({
			action: "prune",
			activeSessionId,
			sources,
		});
		if (!result || Array.isArray(result)) throw new Error(UNAVAILABLE);
		return result;
	}

	private stop(error: Error): void {
		this.generation++;
		const worker = this.worker;
		this.worker = undefined;
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		this.indexed.clear();
		this.excluded.clear();
		this.indexing = undefined;
		if (worker) void worker.terminate();
	}

	close(): void {
		this.stop(new Error("History session changed; retry the query"));
		this.sessionId = undefined;
		this.file = undefined;
	}
}
