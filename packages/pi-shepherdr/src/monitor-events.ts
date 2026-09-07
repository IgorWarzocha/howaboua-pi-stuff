import type { HerdrConnection } from "./herdr-client.js";
import type { HerdrEvent, MonitoringIssue } from "./types.js";

interface SubscriptionAttempt {
	key: string;
	controller: AbortController;
}

interface Subscription {
	attempt: SubscriptionAttempt;
	unsubscribe: () => void;
}

interface MonitorEventsOptions {
	client: HerdrConnection;
	reconnect?: boolean;
	onEvent: (event: HerdrEvent) => void;
	reconcile: () => Promise<void>;
	onWarning: (issue: MonitoringIssue) => void;
	onRecovered: () => void;
	targets: () => string[];
}

export class MonitorEvents {
	private readonly options: MonitorEventsOptions;
	private active = false;
	private epoch = 0;
	private dirty = false;
	private resync = false;
	private refreshTask: Promise<void> | undefined;
	private pending: SubscriptionAttempt | undefined;
	private reconnectTimer: NodeJS.Timeout | undefined;
	private subscription: Subscription | undefined;
	private warning: "degraded" | "unavailable" | undefined;

	constructor(options: MonitorEventsOptions) {
		this.options = options;
	}

	async start(): Promise<void> {
		this.active = true;
		await this.refresh();
	}

	stop(): void {
		this.active = false;
		this.epoch += 1;
		this.dirty = false;
		this.resync = false;
		this.cancelPending();
		this.closeSubscription();
		this.warning = undefined;
		this.clearReconnect();
	}

	async refresh(): Promise<void> {
		this.dirty = this.active;
		this.clearReconnect();
		const key = this.targetKey();
		if (this.pending && this.pending.key !== key) this.cancelPending();
		if (!this.active || key === "[]") {
			this.cancelPending();
			this.closeSubscription();
			if (this.active) this.recovered();
		}
		while (this.dirty || this.refreshTask) {
			this.refreshTask ??= Promise.resolve().then(async () => {
				while (this.active && this.dirty) {
					this.dirty = false;
					await this.update();
				}
			});
			const task = this.refreshTask;
			try {
				await task;
			} finally {
				if (this.refreshTask === task) this.refreshTask = undefined;
			}
		}
	}

	retry(): Promise<void> {
		this.resync = true;
		return this.refresh();
	}

	private targetKey(): string {
		return JSON.stringify([...new Set(this.options.targets())].sort());
	}

	private async update(): Promise<void> {
		const epoch = this.epoch;
		let attempt: SubscriptionAttempt | undefined;
		try {
			if (this.resync) {
				this.resync = false;
				// Remap panes moved during the outage before requesting new coverage.
				await this.options.reconcile();
				if (!this.active || epoch !== this.epoch) return;
			}
			const key = this.targetKey();
			if (key === "[]") {
				this.closeSubscription();
				this.recovered();
				return;
			}
			if (this.subscription?.attempt.key !== key) {
				const candidate = { key, controller: new AbortController() };
				attempt = candidate;
				this.pending = candidate;
				const subscriptions = [
					...this.options.targets().map((paneId) => ({
						type: "pane.agent_status_changed",
						pane_id: paneId,
					})),
					{ type: "pane.moved" },
					{ type: "pane.closed" },
				];
				const unsubscribe = await this.options.client.subscribe(
					subscriptions,
					(event) => {
						if (this.isLive(candidate)) this.options.onEvent(event);
					},
					(error) => this.disconnected(candidate, error),
					candidate.controller.signal,
				);
				if (!this.isLive(candidate) || key !== this.targetKey()) {
					unsubscribe();
					return;
				}
				this.closeSubscription();
				this.subscription = { attempt: candidate, unsubscribe };
				this.pending = undefined;
			}
			// Herdr baselines status before ACK; reconcile afterward to cover setup transitions.
			await this.options.reconcile();
			if (!this.active || epoch !== this.epoch) return;
			if (key !== this.targetKey()) {
				this.dirty = true;
				return;
			}
			if (this.subscription) this.recovered();
		} catch (error) {
			if (
				!this.active ||
				epoch !== this.epoch ||
				attempt?.controller.signal.aborted
			)
				return;
			const failure = error instanceof Error ? error : new Error(String(error));
			this.warn(failure.message);
			if (this.options.reconnect === false) throw failure;
			this.scheduleReconnect();
		} finally {
			if (attempt && this.pending === attempt) this.cancelPending();
		}
	}

	private isLive(attempt: SubscriptionAttempt): boolean {
		return (
			this.active &&
			!attempt.controller.signal.aborted &&
			(this.pending === attempt || this.subscription?.attempt === attempt)
		);
	}

	private cancelPending(): void {
		const pending = this.pending;
		this.pending = undefined;
		pending?.controller.abort();
	}

	private closeSubscription(): void {
		const subscription = this.subscription;
		this.subscription = undefined;
		subscription?.attempt.controller.abort();
		subscription?.unsubscribe();
	}

	private disconnected(attempt: SubscriptionAttempt, error?: Error): void {
		if (!this.isLive(attempt)) return;
		if (this.subscription?.attempt === attempt) this.closeSubscription();
		if (this.pending === attempt) this.cancelPending();
		this.warn(error?.message ?? "event stream closed");
		this.scheduleReconnect();
	}

	private warn(detail: string): void {
		const state = this.subscription ? "degraded" : "unavailable";
		if (this.warning === state) return;
		this.warning = state;
		const message =
			state === "degraded"
				? "Herdr monitor update failed. Existing stream retained, coverage may be incomplete"
				: "Herdr monitoring unavailable";
		this.options.onWarning({
			state,
			message: `${message}: ${detail}${this.options.reconnect === false ? "" : ". Retrying"}`,
		});
	}

	private recovered(): void {
		if (!this.warning) return;
		this.warning = undefined;
		this.options.onRecovered();
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}

	private scheduleReconnect(): void {
		if (!this.active || this.options.reconnect === false || this.reconnectTimer)
			return;
		const epoch = this.epoch;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.retry().catch((error) => {
				if (!this.active || epoch !== this.epoch) return;
				this.warn(error instanceof Error ? error.message : String(error));
				this.scheduleReconnect();
			});
		}, 1_000);
		this.reconnectTimer.unref();
	}
}
