import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { HistorySearch } from "./history-search.js";
import { planSessionPruning } from "./session-pruning-plan.js";
import { RESTART_NOTICE } from "./session-pruning-policy.js";
import { commitSessionPruning } from "./session-pruning-transaction.js";
import type { NotesStore } from "./store.js";
import { windowDetails } from "./windows.js";

const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MiB`;

export class SessionPruning {
	private running = false;
	private observed: string | undefined;
	private pending: string | undefined;
	private epoch = 0;
	private readonly pi: ExtensionAPI;
	private readonly store: NotesStore;
	private readonly search: HistorySearch;
	private readonly admittedWindow: () => string | undefined;
	constructor(
		pi: ExtensionAPI,
		store: NotesStore,
		search: HistorySearch,
		admittedWindow: () => string | undefined,
	) {
		this.pi = pi;
		this.store = store;
		this.search = search;
		this.admittedWindow = admittedWindow;
	}

	private persistedWindow(ctx: ExtensionContext): string | undefined {
		for (const entry of ctx.sessionManager.getBranch().reverse()) {
			const details = windowDetails(entry);
			if (details?.kind === "window")
				return `${ctx.sessionManager.getSessionId()}:${details.identity.currentWindowId}`;
		}
	}
	register(): void {
		this.pi.on("session_start", (_event, ctx) => {
			this.epoch++;
			this.observed = this.persistedWindow(ctx);
			this.pending = undefined;
		});
		this.pi.on("session_shutdown", () => {
			this.epoch++;
			this.pending = undefined;
		});
		this.pi.on("agent_start", (_event, ctx) => {
			// Pi emits agent_start before persisting incoming messages. Notes already
			// admitted the successor in before_agent_start; confirm its commit below.
			const window = this.admittedWindow();
			const current = window
				? `${ctx.sessionManager.getSessionId()}:${window}`
				: undefined;
			if (current && current !== this.observed) this.pending = current;
			this.observed = current;
		});
		// The successor marker and complete turn_end checkpoint are now committed.
		// Ordinary turns without a new-window admission do no pruning work.
		this.pi.on("agent_settled", async (_event, ctx) => {
			if (!this.pending) return;
			const pending = this.pending;
			this.pending = undefined;
			if (pending === this.persistedWindow(ctx)) await this.run(ctx, false);
		});
	}

	async run(ctx: ExtensionContext, manual: boolean): Promise<void> {
		if (this.running) {
			if (manual) ctx.ui.notify("Session pruning is already running.", "info");
			return;
		}
		this.running = true;
		const epoch = this.epoch;
		let historyPruned = false;
		try {
			const policy = this.store.pruningPolicy(
				ctx.sessionManager.getSessionId(),
			);
			if (!policy.windows && !policy.days) {
				if (manual)
					ctx.ui.notify(
						"Session pruning is off. Choose a history or conversation limit first.",
						"info",
					);
				return;
			}
			const plan = await planSessionPruning(ctx.sessionManager, policy);
			if (!plan.changed) {
				await this.search.pruneSession(plan.sessionId, plan.path);
				if (manual)
					ctx.ui.notify(
						"Nothing to prune under this session's limits.",
						"info",
					);
				return;
			}
			if (
				manual &&
				!(await ctx.ui.confirm(
					"Prune this session's history?",
					`${bytes(plan.before)} → about ${bytes(plan.after)}; ${plan.changed} records changed. Current context and saved SQLite notes are protected. Older tool activity, injected instructions and exact execution replay are permanently lost. No backup is kept.${plan.opaque.length ? ` Opaque extension state is retained: ${plan.opaque.join(", ")}.` : ""} ${RESTART_NOTICE}`,
				))
			)
				return;
			const currentPolicy = this.store.pruningPolicy(plan.sessionId);
			if (
				currentPolicy.windows !== policy.windows ||
				currentPolicy.days !== policy.days
			)
				throw new Error("Session pruning settings changed. Run now again.");
			const result = await commitSessionPruning(this.pi, ctx, plan, () => {
				if (this.epoch !== epoch)
					throw new Error(
						"Session changed while pruning was prepared. Run now again.",
					);
				const current = this.store.pruningPolicy(plan.sessionId);
				if (current.windows !== policy.windows || current.days !== policy.days)
					throw new Error("Session pruning settings changed. Run now again.");
			});
			historyPruned = true;
			await this.search.pruneSession(plan.sessionId, plan.path);
			ctx.ui.notify(
				`Pruned session history: ${bytes(result.before)} → ${bytes(result.after)}. Saved notes unchanged. ${RESTART_NOTICE}`,
				"info",
			);
		} catch (error) {
			ctx.ui.notify(
				historyPruned
					? `Session history was pruned, but ranked history cleanup did not complete. Run now again to retry cleanup. ${RESTART_NOTICE}`
					: `Session pruning did not complete: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		} finally {
			this.running = false;
		}
	}
}
