import { CdpClient } from "./client.js";
import { getWebSocketUrl } from "./discovery.js";
import { waitForTurn } from "./serial.js";
import type { ElementRefs } from "./types.js";
import { asRecord } from "./types.js";

const TAB_IDLE_MS = 20 * 60 * 1_000;

export interface ActiveTab {
	cdp: CdpClient;
	sessionId: string;
	elementRefs: ElementRefs;
	refId: string;
}

export class TabBridge {
	readonly elementRefs: ElementRefs = new Map();
	readonly targetId: string;
	readonly cdp: CdpClient;
	readonly sessionId: string;
	private tail = Promise.resolve();
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private closed = false;
	private backgroundRendering: boolean | undefined = false;
	private readonly onClose: () => void;

	private constructor(
		targetId: string,
		cdp: CdpClient,
		sessionId: string,
		onClose: () => void,
	) {
		this.targetId = targetId;
		this.cdp = cdp;
		this.sessionId = sessionId;
		this.onClose = onClose;
		this.resetIdle();
		cdp.onEvent("Target.targetDestroyed", (value) => {
			const event = asRecord(value, "target destroyed event");
			if (event["targetId"] === targetId) this.close(false);
		});
		cdp.onEvent("Target.detachedFromTarget", (value) => {
			const event = asRecord(value, "target detached event");
			if (event["sessionId"] === sessionId) this.close(false);
		});
		cdp.onClose(() => this.close(false));
	}

	static async connect(
		targetId: string,
		onClose: () => void,
		signal?: AbortSignal,
	): Promise<TabBridge> {
		const cdp = new CdpClient();
		try {
			await cdp.connect(await getWebSocketUrl(), signal);
			const response = asRecord(
				await cdp.send(
					"Target.attachToTarget",
					{ targetId, flatten: true },
					undefined,
					signal,
				),
				"Target.attachToTarget response",
			);
			if (typeof response["sessionId"] !== "string") {
				throw new Error("Chrome did not return a tab session");
			}
			return new TabBridge(targetId, cdp, response["sessionId"], onClose);
		} catch (error) {
			cdp.close();
			throw error;
		}
	}

	async run<T>(
		refId: string,
		signal: AbortSignal | undefined,
		action: (tab: ActiveTab) => Promise<T>,
	): Promise<T> {
		if (this.closed) throw new Error("Tab bridge is closed");
		let release!: () => void;
		const turn = new Promise<void>((resolveValue) => {
			release = resolveValue;
		});
		const previous = this.tail;
		this.tail = previous.then(
			() => turn,
			() => turn,
		);
		try {
			await waitForTurn(previous, signal);
			if (this.closed) throw new Error("Tab bridge is closed");
			this.resetIdle();
			return await action({
				cdp: this.cdp,
				sessionId: this.sessionId,
				elementRefs: this.elementRefs,
				refId,
			});
		} finally {
			release();
		}
	}

	async setBackgroundRendering(
		enabled: boolean,
		signal?: AbortSignal,
	): Promise<void> {
		if (this.backgroundRendering === enabled) return;
		// An interrupted command may already have applied. Keep the state unknown
		// until Chrome acknowledges it, so the next action reestablishes it.
		this.backgroundRendering = undefined;
		await this.cdp.send(
			"Emulation.setFocusEmulationEnabled",
			{ enabled },
			this.sessionId,
			signal,
		);
		this.backgroundRendering = enabled;
	}

	close(detach = true): void {
		if (this.closed) return;
		this.closed = true;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.elementRefs.clear();
		if (detach) {
			void this.cdp
				.send(
					"Target.detachFromTarget",
					{ sessionId: this.sessionId },
					undefined,
					undefined,
				)
				.catch(() => undefined)
				.finally(() => this.cdp.close());
		} else {
			this.cdp.close();
		}
		this.onClose();
	}

	private resetIdle(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => this.close(), TAB_IDLE_MS);
		this.idleTimer.unref?.();
	}
}
