import type { HerdrConnection } from "./herdr-client.js";
import type { HerdrEvent } from "./types.js";

interface Subscription {
	generation: number;
	unsubscribe: () => void;
}

interface MonitorEventsOptions {
	client: HerdrConnection;
	reconnect?: boolean;
	onEvent: (event: HerdrEvent) => void;
	onReconnect: () => Promise<void>;
	onWarning: (message: string) => void;
	targets: () => string[];
}

export class MonitorEvents {
	private readonly options: MonitorEventsOptions;
	private active = false;
	private generation = 0;
	private readonly live = new Set<number>();
	private reconnectTimer: NodeJS.Timeout | undefined;
	private subscription: Subscription | undefined;
	private warningShown = false;

	constructor(options: MonitorEventsOptions) {
		this.options = options;
	}

	async start(): Promise<void> {
		this.active = true;
		await this.refresh();
	}

	stop(): void {
		this.active = false;
		this.generation += 1;
		this.live.clear();
		this.subscription?.unsubscribe();
		this.subscription = undefined;
		this.warningShown = false;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}

	async refresh(): Promise<void> {
		const generation = ++this.generation;
		const previous = this.subscription;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
		const targets = this.options.targets();
		if (!this.active || targets.length === 0) {
			this.close(previous);
			this.subscription = undefined;
			return;
		}

		const subscriptions = [
			...targets.map((paneId) => ({
				type: "pane.agent_status_changed",
				pane_id: paneId,
			})),
			{ type: "pane.moved" },
			{ type: "pane.closed" },
		];
		this.live.add(generation);
		try {
			const unsubscribe = await this.options.client.subscribe(
				subscriptions,
				(event) => {
					if (this.active && this.live.has(generation)) {
						this.options.onEvent(event);
					}
				},
				(error) => {
					this.live.delete(generation);
					if (error)
						this.warn(`Herdr monitoring disconnected: ${error.message}`);
					this.scheduleReconnect(generation, true);
				},
			);
			if (
				!this.active ||
				generation !== this.generation ||
				!this.live.has(generation)
			) {
				this.live.delete(generation);
				unsubscribe();
				return;
			}
			this.close(previous);
			this.subscription = { generation, unsubscribe };
			this.warningShown = false;
		} catch (error) {
			this.live.delete(generation);
			if (!this.active || generation !== this.generation) return;
			this.warn(
				`Herdr monitoring unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
			this.scheduleReconnect(generation, false);
		}
	}

	private close(subscription: Subscription | undefined): void {
		if (!subscription) return;
		this.live.delete(subscription.generation);
		subscription.unsubscribe();
	}

	private warn(message: string): void {
		if (this.warningShown) return;
		this.warningShown = true;
		this.options.onWarning(message);
	}

	private scheduleReconnect(generation: number, disconnected: boolean): void {
		if (!this.active || generation !== this.generation) return;
		if (this.options.reconnect === false) return;
		if (disconnected && this.subscription?.generation === generation) {
			this.subscription = undefined;
		}
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.options
				.onReconnect()
				.then(() => this.refresh())
				.catch((error) => {
					this.warn(
						`Herdr monitoring reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
					);
					this.scheduleReconnect(generation, false);
				});
		}, 1_000);
		this.reconnectTimer.unref();
	}
}
