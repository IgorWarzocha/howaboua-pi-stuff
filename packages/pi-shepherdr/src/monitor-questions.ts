import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sameAgentIdentity } from "./ask-answer.js";
import { getAgent, sessionPath } from "./herdr.js";
import type { HerdrConnection } from "./herdr-client.js";
import type { MonitorState } from "./monitor-state.js";
import type { AssistantReader } from "./session-reader.js";
import type { MonitoredAgent, PaneInfo, PendingAsk } from "./types.js";

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

	refresh(panels: PaneInfo[]): Promise<void> {
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
					const current = await getAgent(this.options.client, panel.pane_id);
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
