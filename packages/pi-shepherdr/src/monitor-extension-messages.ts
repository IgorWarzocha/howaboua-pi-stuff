import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sameAgentIdentity } from "./agent-identity.js";
import { getAgent, sessionPath } from "./herdr.js";
import { type HerdrConnection, isHerdrErrorCode } from "./herdr-client.js";
import type { MonitorState } from "./monitor-state.js";
import { extensionMessageKey } from "./remote/shepherdr-session.mjs";
import type { AssistantReader } from "./session-reader.js";
import type { ExtensionMessage, MonitoredAgent, PaneInfo } from "./types.js";

interface MonitorExtensionMessagesOptions {
	client: HerdrConnection;
	machine: string;
	machineLabel: () => string;
	reader: AssistantReader;
	state: MonitorState;
	notify: (
		ctx: ExtensionContext,
		record: MonitoredAgent,
		panel: PaneInfo,
		message: ExtensionMessage,
	) => void;
	persist: () => void;
}

// Extension messages are attention events, not settlements of delegated work.
export class MonitorExtensionMessages {
	private context: ExtensionContext | undefined;
	private generation = 0;
	private panels: PaneInfo[] = [];
	private key = "";
	private controller: AbortController | undefined;
	private unsubscribe: (() => void) | undefined;
	private refreshTail = Promise.resolve();
	private readonly checks = new Map<string, { dirty: boolean }>();

	private warned = false;
	private readonly options: MonitorExtensionMessagesOptions;

	constructor(options: MonitorExtensionMessagesOptions) {
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
					const after = await getAgent(
						this.options.client,
						panel.pane_id,
					).catch((error: unknown) => {
						if (isHerdrErrorCode(error, "agent_not_found")) return undefined;
						throw error;
					});
					if (generation !== this.generation || !this.context) return;
					if (!after || !sameAgentIdentity(panel, after)) continue;
					const record = this.options.state.byTerminal(current.terminal_id);
					if (!record || record.paneId !== current.pane_id) continue;
					const messages = view.extensionMessages ?? [];
					let changed = this.options.state.retainExtensionNotifications(
						record.terminalId,
						messages.map(extensionMessageKey),
					);
					for (const message of messages) {
						// Blocking messages arrive with the worker's settlement.
						if (message.blocking) continue;
						const key = extensionMessageKey(message);
						if (record.notifiedExtensionMessages?.includes(key)) continue;
						this.options.notify(this.context, record, current, message);
						changed =
							this.options.state.markExtensionMessage(record.terminalId, key) ||
							changed;
					}
					if (changed) this.options.persist();
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
		const label = this.options.machineLabel();
		const machine =
			label === this.options.machine
				? label
				: `${label} (${this.options.machine})`;
		const detail =
			error instanceof Error && "code" in error && error.code === "EPIPE"
				? "the connection closed"
				: error instanceof Error
					? error.message
					: String(error);
		this.context?.ui.notify(
			`Worker notices unavailable on ${machine}: ${detail}. Open /herdr → Status to reconnect. Then use agents read to check worker messages.`,
			"warning",
		);
	}
}
