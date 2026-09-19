import { CdpClient } from "./client.js";
import {
	getDisplayPrefixLength,
	getWebSocketUrl,
	resolvePrefix,
} from "./discovery.js";
import { waitForTurn } from "./serial.js";
import { BrowserTabs } from "./tabs.js";
import type { ElementRefs, PageInfo } from "./types.js";
import { asRecord } from "./types.js";

const TAB_IDLE_MS = 20 * 60 * 1_000;

export interface ActiveTab {
	cdp: CdpClient;
	sessionId: string;
	elementRefs: ElementRefs;
	refId: string;
}

interface PendingConnection<T> {
	controller: AbortController;
	promise: Promise<T>;
	value?: T;
}

interface BrowserConnection {
	cdp: CdpClient;
	tabs: BrowserTabs;
}

class TabBridge {
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

export class BrowserCdpSession {
	private closing: Promise<void> | undefined;
	private root: BrowserConnection | undefined;
	private rootPending: PendingConnection<BrowserConnection> | undefined;
	private readonly ownerId: string;
	private readonly ownershipDirectory: string;
	private readonly tabs = new Map<string, TabBridge>();
	private readonly tabPromises = new Map<
		string,
		PendingConnection<TabBridge>
	>();

	constructor(ownerId: string, ownershipDirectory: string) {
		this.ownerId = ownerId;
		this.ownershipDirectory = ownershipDirectory;
	}

	async pages(signal?: AbortSignal): Promise<PageInfo[]> {
		return (await this.rootConnection(signal)).tabs.list(signal);
	}

	async open(
		url: string,
		signal?: AbortSignal,
	): Promise<{
		refId: string;
	}> {
		return (await this.rootConnection(signal)).tabs.open(url, signal);
	}

	async show(refId: string, signal?: AbortSignal): Promise<string> {
		return (await this.rootConnection(signal)).tabs.show(refId, signal);
	}

	async closeTab(refId: string, signal?: AbortSignal): Promise<string> {
		const root = await this.rootConnection(signal);
		const resolved = await root.tabs.resolve(refId, signal);
		if (!resolved.page.owned)
			throw new Error(
				"Only tabs owned by this Pi session can be closed; shared tabs remain open",
			);
		const targetId = resolved.page.targetId;
		this.stopPendingTab(targetId, "Tab is closing");
		const bridge = this.tabs.get(targetId);
		const close = () => root.tabs.close(targetId, signal);
		const closed = bridge
			? await bridge.run(resolved.refId, signal, close)
			: await close();
		bridge?.close(false);
		return closed.refId;
	}

	async withTab<T>(
		refId: string,
		signal: AbortSignal | undefined,
		action: (tab: ActiveTab) => Promise<T>,
	): Promise<T> {
		const pages = await this.pages(signal);
		const targetId = resolvePrefix(
			refId,
			pages.map((page) => page.targetId),
			"target",
			"Run tabs.",
		);
		let bridge = this.tabs.get(targetId);
		if (!bridge) {
			let pending = this.tabPromises.get(targetId);
			if (!pending) {
				const controller = new AbortController();
				const promise = this.connectTab(targetId, controller.signal);
				pending = { controller, promise };
				this.tabPromises.set(targetId, pending);
				void promise.then(
					(value) => {
						pending!.value = value;
					},
					() => {
						if (this.tabPromises.get(targetId) === pending) {
							this.tabPromises.delete(targetId);
						}
					},
				);
			}
			const connected = await waitForTurn(pending.promise, signal);
			bridge = this.tabs.get(targetId);
			if (!bridge) {
				if (this.tabPromises.get(targetId) !== pending) {
					connected.close();
					throw new Error("Tab bridge was stopped while connecting");
				}
				this.tabPromises.delete(targetId);
				this.tabs.set(targetId, connected);
				bridge = connected;
			} else if (bridge !== connected) {
				connected.close();
			}
		}
		const prefixLength = getDisplayPrefixLength(
			pages.map((page) => page.targetId),
		);
		const owned = pages.some(
			(page) => page.targetId === targetId && page.owned === true,
		);
		const current = bridge;
		return current.run(targetId.slice(0, prefixLength), signal, async (tab) => {
			await current.setBackgroundRendering(owned, signal);
			return action(tab);
		});
	}

	async stop(refId?: string): Promise<void> {
		if (!refId) {
			for (const targetId of this.tabPromises.keys()) {
				this.stopPendingTab(targetId, "All tab bridges were stopped");
			}
			for (const bridge of this.tabs.values()) bridge.close();
			this.tabs.clear();
			return;
		}
		const pages = await this.pages();
		const targetId = resolvePrefix(
			refId,
			pages.map((page) => page.targetId),
			"target",
		);
		this.stopPendingTab(targetId, "Tab bridge " + refId + " was stopped");
		this.tabs.get(targetId)?.close();
		this.tabs.delete(targetId);
	}

	close(): Promise<void> {
		if (this.closing) return this.closing;
		for (const targetId of this.tabPromises.keys()) {
			this.stopPendingTab(targetId, "Browser session closed");
		}
		for (const bridge of this.tabs.values()) bridge.close();
		this.tabs.clear();
		const rootPending = this.rootPending;
		this.rootPending = undefined;
		rootPending?.controller.abort(new Error("Browser session closed"));
		const root = this.root;
		this.root = undefined;
		this.closing = (async () => {
			const connected = await rootPending?.promise.catch(() => undefined);
			for (const connection of new Set([root, connected])) {
				if (!connection) continue;
				try {
					await connection.tabs.shutdown();
				} finally {
					connection.cdp.close();
				}
			}
		})();
		return this.closing;
	}

	private async rootConnection(
		signal?: AbortSignal,
	): Promise<BrowserConnection> {
		if (this.closing) throw new Error("Browser session closed");
		if (this.root) return this.root;
		let pending = this.rootPending;
		if (!pending) {
			const controller = new AbortController();
			const promise = this.connectRoot(controller.signal);
			pending = { controller, promise };
			this.rootPending = pending;
			void promise.then(
				(value) => {
					pending!.value = value;
					if (this.rootPending === pending) this.rootPending = undefined;
				},
				() => {
					if (this.rootPending === pending) this.rootPending = undefined;
				},
			);
		}
		return waitForTurn(pending.promise, signal);
	}

	private async connectTab(
		targetId: string,
		signal?: AbortSignal,
	): Promise<TabBridge> {
		let bridge: TabBridge | undefined;
		bridge = await TabBridge.connect(
			targetId,
			() => {
				if (bridge && this.tabs.get(targetId) === bridge) {
					this.tabs.delete(targetId);
				}
				const pending = this.tabPromises.get(targetId);
				if (bridge && pending?.value === bridge) {
					this.tabPromises.delete(targetId);
				}
			},
			signal,
		);
		return bridge;
	}

	private stopPendingTab(targetId: string, message: string): void {
		const pending = this.tabPromises.get(targetId);
		if (!pending) return;
		this.tabPromises.delete(targetId);
		pending.controller.abort(new Error(message));
		void pending.promise.then(
			(bridge) => bridge.close(),
			() => undefined,
		);
	}

	private async connectRoot(signal: AbortSignal): Promise<BrowserConnection> {
		const client = new CdpClient();
		const url = await getWebSocketUrl();
		try {
			await client.connect(url, signal);
			signal.throwIfAborted();
			if (this.closing) throw new Error("Browser session closed");
		} catch (error) {
			client.close();
			throw error;
		}
		const connection = {
			cdp: client,
			tabs: new BrowserTabs(client, this.ownerId, this.ownershipDirectory, url),
		};
		this.root = connection;
		client.onClose(() => {
			if (this.root !== connection) return;
			this.root = undefined;
		});
		return connection;
	}
}
