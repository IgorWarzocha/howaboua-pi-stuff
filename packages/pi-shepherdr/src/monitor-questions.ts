import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sameAgentIdentity } from "./ask-answer.js";
import { getAgent, sessionPath } from "./herdr.js";
import { type HerdrConnection, isHerdrErrorCode } from "./herdr-client.js";
import type { MonitorState } from "./monitor-state.js";
import type { AssistantReader } from "./session-reader.js";
import type {
	AskResult,
	MonitoredAgent,
	PaneInfo,
	PendingAsk,
} from "./types.js";

const ASK_RESULT_TIMEOUT_MS = 10_000;

interface MonitorQuestionsOptions {
	client: HerdrConnection;
	reader: AssistantReader;
	state: MonitorState;
	notify: (
		ctx: ExtensionContext,
		record: MonitoredAgent,
		panel: PaneInfo,
		ask: PendingAsk,
	) => void;
	persist: () => void;
}

// Questions are attention events, not settlements of delegated work.
export class MonitorQuestions {
	private context: ExtensionContext | undefined;
	private generation = 0;
	private panels: PaneInfo[] = [];
	private key = "";
	private controller: AbortController | undefined;
	private unsubscribe: (() => void) | undefined;
	private refreshTail = Promise.resolve();
	private readonly checks = new Map<string, { dirty: boolean }>();
	private readonly answers = new Set<AbortController>();
	private warned = false;
	private readonly options: MonitorQuestionsOptions;

	constructor(options: MonitorQuestionsOptions) {
		this.options = options;
	}

	start(ctx: ExtensionContext): void {
		this.stop();
		this.context = ctx;
	}

	stop(): void {
		this.generation++;
		for (const controller of this.answers) controller.abort();
		this.context = undefined;
		this.panels = [];
		this.key = "";
		this.controller?.abort();
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.controller = undefined;
		this.checks.clear();
		this.warned = false;
		this.refreshTail = Promise.resolve();
	}

	submitAnswer(
		panel: PaneInfo,
		askId: string,
		submit: (signal: AbortSignal) => Promise<void>,
		signal: AbortSignal,
	): Promise<AskResult | undefined> {
		signal.throwIfAborted();
		const path = sessionPath(panel);
		if (!path) return Promise.resolve(undefined);
		const controller = new AbortController();
		this.answers.add(controller);
		return new Promise((resolve, reject) => {
			let closed = false;
			let unsubscribe: (() => void) | undefined;
			let submitted = false;
			let checking = false;
			let dirty = false;
			const finish = (result?: AskResult, error?: unknown) => {
				if (closed) return;
				closed = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", cancel);
				controller.signal.removeEventListener("abort", stopped);
				controller.abort();
				unsubscribe?.();
				this.answers.delete(controller);
				if (error !== undefined) reject(error);
				else resolve(result);
			};
			const cancel = () => finish(undefined, signal.reason);
			const stopped = () => finish(undefined, controller.signal.reason);
			const timer = setTimeout(() => finish(), ASK_RESULT_TIMEOUT_MS);
			signal.addEventListener("abort", cancel, { once: true });
			controller.signal.addEventListener("abort", stopped, { once: true });
			const check = () => {
				dirty = true;
				if (closed || !submitted || checking) return;
				checking = true;
				void (async () => {
					while (dirty && !closed) {
						dirty = false;
						const current = await getAgent(this.options.client, panel.pane_id);
						if (closed) return;
						if (!sameAgentIdentity(panel, current)) return finish();
						const view = await this.options.reader.view(path);
						if (closed) return;
						// Identity may change while the session read is in flight.
						const after = await getAgent(this.options.client, panel.pane_id);
						if (closed) return;
						if (!sameAgentIdentity(panel, after)) return finish();
						// Ask can leave the UI before its close record is persisted.
						const result = view.askResults?.[askId];
						if (result) return finish(result);
					}
				})()
					.catch((error) => finish(undefined, error))
					.finally(() => {
						checking = false;
						if (dirty && !closed) check();
					});
			};
			void (async () => {
				// The reader belongs to this machine. Cover persistence before Enter.
				const close = await this.options.reader.watch(
					[path],
					check,
					(error) => finish(undefined, error),
					controller.signal,
				);
				if (closed) return close();
				unsubscribe = close;
				await submit(controller.signal);
				if (closed) return;
				submitted = true;
				// Read after subscription and submit ACK even if no event was observed.
				check();
			})().catch((error) => finish(undefined, error));
		});
	}

	refresh(panels: PaneInfo[] = this.panels): Promise<void> {
		this.panels = panels.filter(
			(panel) =>
				this.options.state.byTerminal(panel.terminal_id) && sessionPath(panel),
		);
		const generation = this.generation;
		const update = async () => {
			if (!this.context || generation !== this.generation) return;
			const paths = [
				...new Set(this.panels.map((panel) => sessionPath(panel)!)),
			].sort();
			const key = JSON.stringify(paths);
			if (key !== this.key) {
				this.controller?.abort();
				this.unsubscribe?.();
				this.unsubscribe = undefined;
				this.key = "";
				const controller = new AbortController();
				this.controller = controller;
				if (paths.length) {
					const close = await this.options.reader.watch(
						paths,
						(path) => {
							if (!controller.signal.aborted) this.check(path);
						},
						(error) => {
							if (controller.signal.aborted) return;
							controller.abort();
							this.key = "";
							this.warning(error);
						},
						controller.signal,
					);
					if (generation !== this.generation || controller.signal.aborted) {
						close();
						return;
					}
					this.unsubscribe = close;
				}
				this.key = key;
			}
			// Subscribe before reading to cover changes during setup and restoration.
			for (const path of paths) this.check(path);
		};
		this.refreshTail = this.refreshTail.then(update, update).catch((error) => {
			if (generation === this.generation) this.warning(error);
		});
		return this.refreshTail;
	}

	private check(path: string): void {
		const existing = this.checks.get(path);
		if (existing) {
			existing.dirty = true;
			return;
		}
		const check = { dirty: true };
		this.checks.set(path, check);
		const generation = this.generation;
		void (async () => {
			while (check.dirty && generation === this.generation && this.context) {
				check.dirty = false;
				for (const panel of this.panels.filter(
					(panel) => sessionPath(panel) === path,
				)) {
					if (!this.options.state.byTerminal(panel.terminal_id)) continue;
					const current = await getAgent(
						this.options.client,
						panel.pane_id,
					).catch((error: unknown) => {
						// Pane closure can precede its lifecycle event or finish an in-flight read.
						if (isHerdrErrorCode(error, "agent_not_found")) return undefined;
						throw error;
					});
					if (!current) continue;
					if (!sameAgentIdentity(panel, current)) continue;
					const view = await this.options.reader.view(path);
					if (generation !== this.generation || !this.context) return;
					const record = this.options.state.byTerminal(current.terminal_id);
					const ask = view.ask;
					if (
						!record ||
						record.paneId !== current.pane_id ||
						ask?.delivery !== "steer" ||
						record.lastQuestionId === ask.toolCallId
					)
						continue;
					this.options.notify(this.context, record, current, ask);
					if (
						this.options.state.markQuestion(record.terminalId, ask.toolCallId)
					)
						this.options.persist();
				}
			}
		})()
			.catch((error) => {
				if (generation === this.generation) this.warning(error);
			})
			.finally(() => {
				if (this.checks.get(path) === check) this.checks.delete(path);
			});
	}

	private warning(error: unknown): void {
		if (this.warned) return;
		this.warned = true;
		this.context?.ui.notify(
			`Async question monitoring unavailable: ${error instanceof Error ? error.message : String(error)}. Use agents read to inspect workers; reconnect through /herdr`,
			"warning",
		);
	}
}
