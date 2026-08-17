import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type LanRemoteStaticAsset,
	resolveLanRemoteCustomApp,
} from "./custom-app.ts";
import { remoteJsonValue } from "./remote-json.ts";

const PROTOCOL = "@howaboua/pi-gippity-control/remote-app/v1";
const AVAILABLE_CHANNEL = `${PROTOCOL}/available`;
const REQUEST_CHANNEL = `${PROTOCOL}/request`;
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_APP_MESSAGE_BYTES = 64 * 1024;

export type GippityRemoteAppUpdate =
	| { state: unknown; event?: never; data?: never }
	| { event: string; data: unknown; state?: never };

export interface GippityRemoteAppProvider {
	id: string;
	root: string;
	snapshot(): unknown;
	subscribe(listener: (update: GippityRemoteAppUpdate) => void): () => void;
}

interface GippityRemoteAppBroker {
	protocol: typeof PROTOCOL;
	isActive(): boolean;
	register(provider: GippityRemoteAppProvider): (() => void) | undefined;
}

export interface GippityRemoteAppRegistration {
	readonly available: boolean;
	dispose(): void;
}

export interface GippityRemoteAppMessage {
	type: "app.event" | "app.state";
	app: string;
	event?: string | undefined;
	data: unknown;
}

export type GippityRemoteAppRoute =
	| { kind: "none" }
	| { kind: "missing" }
	| { kind: "redirect"; location: string }
	| { kind: "asset"; asset: LanRemoteStaticAsset };

function validName(value: unknown): value is string {
	return typeof value === "string" && NAME_PATTERN.test(value);
}

function assertProvider(provider: GippityRemoteAppProvider): void {
	if (!validName(provider.id))
		throw new Error("GipPity remote app id is invalid");
	if (
		typeof provider.root !== "string" ||
		Buffer.byteLength(provider.root) > 512 ||
		!isAbsolute(provider.root)
	)
		throw new Error("GipPity remote app root must be a bounded absolute path");
	if (
		typeof provider.snapshot !== "function" ||
		typeof provider.subscribe !== "function"
	)
		throw new Error("GipPity remote app provider is invalid");
}

function isBroker(value: unknown): value is GippityRemoteAppBroker {
	if (!value || typeof value !== "object") return false;
	const broker = value as Partial<GippityRemoteAppBroker>;
	return (
		broker.protocol === PROTOCOL &&
		typeof broker.isActive === "function" &&
		typeof broker.register === "function"
	);
}

export function registerGippityRemoteApp(
	pi: Pick<ExtensionAPI, "events" | "on">,
	provider: GippityRemoteAppProvider,
): GippityRemoteAppRegistration {
	assertProvider(provider);
	let broker: GippityRemoteAppBroker | undefined;
	let unregisterProvider: (() => void) | undefined;
	let disposed = false;
	const unregisterAvailable = pi.events.on(AVAILABLE_CHANNEL, (value) => {
		if (disposed || !isBroker(value) || value === broker) return;
		unregisterProvider?.();
		broker = value;
		unregisterProvider = value.register(provider);
	});
	const registration: GippityRemoteAppRegistration = {
		get available() {
			return !disposed && Boolean(unregisterProvider && broker?.isActive());
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			unregisterAvailable();
			unregisterProvider?.();
			unregisterProvider = undefined;
			broker = undefined;
		},
	};
	pi.on("session_shutdown", () => registration.dispose());
	pi.events.emit(REQUEST_CHANNEL, { protocol: PROTOCOL });
	return registration;
}

function message(
	provider: GippityRemoteAppProvider,
	update: GippityRemoteAppUpdate,
): GippityRemoteAppMessage {
	const event = update.event;
	if (event !== undefined && !validName(event))
		throw new Error("GipPity remote app event is invalid");
	if ((event === undefined) !== "state" in update)
		throw new Error(
			"GipPity remote app update must contain one event or state",
		);
	const result: GippityRemoteAppMessage = event
		? {
				type: "app.event",
				app: provider.id,
				event,
				data: remoteJsonValue(update.data),
			}
		: {
				type: "app.state",
				app: provider.id,
				data: remoteJsonValue(update.state),
			};
	if (Buffer.byteLength(JSON.stringify(result)) > MAX_APP_MESSAGE_BYTES)
		throw new Error("GipPity remote app update is too large");
	return result;
}

export class GippityRemoteApps {
	readonly #listeners = new Set<(message: GippityRemoteAppMessage) => void>();
	#provider: GippityRemoteAppProvider | undefined;
	#unsubscribeProvider: (() => void) | undefined;
	readonly #broker: GippityRemoteAppBroker = {
		protocol: PROTOCOL,
		isActive: () => true,
		register: (provider) => this.#register(provider),
	};

	constructor(pi: Pick<ExtensionAPI, "events">) {
		pi.events.on(REQUEST_CHANNEL, (value) => {
			if (
				value &&
				typeof value === "object" &&
				(value as { protocol?: unknown }).protocol === PROTOCOL
			)
				pi.events.emit(AVAILABLE_CHANNEL, this.#broker);
		});
		pi.events.emit(AVAILABLE_CHANNEL, this.#broker);
	}

	apps(): Array<{ id: string; path: string }> {
		const provider = this.#provider;
		return provider
			? [{ id: provider.id, path: `/_gippity/apps/${provider.id}/` }]
			: [];
	}

	route(path: string): GippityRemoteAppRoute {
		const provider = this.#provider;
		if (!provider) return { kind: "none" };
		const base = `/_gippity/apps/${provider.id}`;
		if (path === base) return { kind: "redirect", location: `${base}/` };
		if (!path.startsWith(`${base}/`)) return { kind: "none" };
		const app = resolveLanRemoteCustomApp(provider.root, provider.root);
		const asset = app?.asset(path.slice(base.length));
		return asset ? { kind: "asset", asset } : { kind: "missing" };
	}

	snapshot(): GippityRemoteAppMessage | undefined {
		const provider = this.#provider;
		return provider
			? message(provider, { state: provider.snapshot() })
			: undefined;
	}

	onMessage(listener: (message: GippityRemoteAppMessage) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#register(provider: GippityRemoteAppProvider): (() => void) | undefined {
		assertProvider(provider);
		const initial = message(provider, { state: provider.snapshot() });
		const unsubscribe = provider.subscribe((update) => {
			if (this.#provider !== provider) return;
			const next = message(provider, update);
			for (const listener of this.#listeners) listener(next);
		});
		const previous = this.#unsubscribeProvider;
		this.#provider = provider;
		this.#unsubscribeProvider = unsubscribe;
		previous?.();
		for (const listener of this.#listeners) listener(initial);
		return () => {
			if (this.#provider !== provider) return;
			this.#unsubscribeProvider?.();
			this.#unsubscribeProvider = undefined;
			this.#provider = undefined;
		};
	}
}
