import { hostname } from "node:os";
import type { HerdrConnection } from "../herdr-client.js";
import { openPeerChannel } from "../remote/shepherdr-channel.mjs";
import { requestContext } from "../remote/shepherdr-context.mjs";
import {
	readPeerCommands,
	sendPeerCommands,
	sendPeerExtensionReply,
	sendPeerFocus,
	sendPeerMessage,
} from "../remote/shepherdr-peer.mjs";
import type {
	ExtensionReply,
	FocusRequest,
	HerdrEvent,
	PaneInfo,
	PeerChannel,
	PeerMessage,
} from "../types.js";
import { CoreClient } from "./client.js";
import { openCoreFocusChannel } from "./focus-channel.js";
import { object } from "./protocol.js";
import { RemoteCoreEndpoint } from "./remote-endpoint.js";
import { type CoreMachine, remoteExec } from "./remote-exec.js";
import { CoreRemoteReader } from "./remote-reader.js";
import { CoreContextRelay } from "./remote-relay.js";
import { dispatchCoreRequest } from "./request.js";

export class CoreConnection implements HerdrConnection {
	private readonly lifetime = new AbortController();
	private readonly focusChannels = new Set<PeerChannel>();
	private relay: CoreContextRelay | undefined;
	private readonly socketPath: string;
	readonly core: CoreClient | RemoteCoreEndpoint;
	readonly remote: CoreMachine | undefined;
	readonly reader: CoreRemoteReader | undefined;
	constructor(
		socketPath = process.env["HC_TERMINAL_SOCKET"],
		remote?: CoreMachine,
	) {
		if (!socketPath)
			throw new Error("Run Pi inside a Core terminal to connect Shepherdr");
		this.remote = remote;
		this.socketPath = socketPath;
		this.core = remote
			? new RemoteCoreEndpoint(socketPath, remote)
			: new CoreClient(socketPath);
		this.reader =
			this.core instanceof RemoteCoreEndpoint
				? new CoreRemoteReader(this.core)
				: undefined;
	}
	close(): void {
		this.lifetime.abort();
		for (const channel of this.focusChannels) channel.close();
		this.focusChannels.clear();
		void this.relay?.close();
		this.core.close();
	}
	async machineIdentity() {
		const hello = object(await this.core.request("hello"));
		const core = object(hello["core"]);
		if (typeof core["id"] !== "string" || !core["id"])
			throw new Error("Core returned no stable identity");
		return {
			host:
				this.remote && typeof core["name"] === "string"
					? core["name"]
					: hostname(),
			session: core["id"],
		};
	}
	requestContext(path: string, request: unknown, signal?: AbortSignal) {
		if (this.core instanceof RemoteCoreEndpoint)
			return remoteExec(
				this.core.host,
				this.core.machine,
				{ op: "context", path, request },
				signal ? { signal } : {},
			);
		return requestContext(path, request, signal);
	}
	async startContextRelay(
		threadId: string,
		_routeId: string,
		handler: (request: unknown, signal: AbortSignal) => Promise<unknown>,
		onFailure: (error: Error) => void = () => {},
	): Promise<void> {
		if (!this.remote)
			throw new Error("Local context routes use the controller session");
		this.lifetime.signal.throwIfAborted();
		await this.relay?.close();
		this.lifetime.signal.throwIfAborted();
		const relay = new CoreContextRelay(this.socketPath, this.remote);
		this.relay = relay;
		try {
			await relay.start(threadId, handler, onFailure);
		} catch (error) {
			await relay.close();
			throw error;
		}
	}
	contextRelayPath(): string {
		if (!this.relay)
			throw new Error(
				"Shared context relay is unavailable; open /herdr → Status to retry sharing",
			);
		return this.relay.path();
	}
	async directory(
		value: string | undefined,
		fallback: string,
	): Promise<string> {
		if (!(this.core instanceof RemoteCoreEndpoint))
			throw new Error("Use local directory resolution on the local Core");
		const result = await remoteExec(this.core.host, this.core.machine, {
			op: "directory",
			value,
			fallback,
		});
		if (typeof result !== "string")
			throw new Error("Remote directory returned no path");
		return result;
	}
	async sendMessage(agent: PaneInfo, message: PeerMessage) {
		if (this.core instanceof RemoteCoreEndpoint) {
			const result = object(
				await remoteExec(this.core.host, this.core.machine, {
					op: "message",
					agent,
					message,
				}),
			);
			if (
				typeof result["command"] !== "boolean" ||
				(result["result"] !== undefined && typeof result["result"] !== "string")
			)
				throw new Error(
					"Remote delivery was not acknowledged; inspect the target before retrying",
				);
			return {
				command: result["command"],
				...(typeof result["result"] === "string"
					? { result: result["result"] }
					: {}),
				...(result["commands"] !== undefined
					? { commands: readPeerCommands(result["commands"]) }
					: {}),
			};
		}
		return sendPeerMessage(
			(method, params) => this.request(method, params),
			agent,
			message,
		);
	}
	async commands(agent: PaneInfo) {
		if (this.core instanceof RemoteCoreEndpoint)
			return readPeerCommands(
				await remoteExec(this.core.host, this.core.machine, {
					op: "commands",
					agent,
				}),
			);
		return sendPeerCommands(
			(method, params) => this.request(method, params),
			agent,
		);
	}
	async replyExtension(agent: PaneInfo, reply: ExtensionReply) {
		if (this.core instanceof RemoteCoreEndpoint) {
			const result = await remoteExec(this.core.host, this.core.machine, {
				op: "reply",
				agent,
				reply,
			});
			if (typeof result !== "string")
				throw new Error(
					"Remote extension reply was not acknowledged; inspect the target before retrying",
				);
			return result;
		}
		return sendPeerExtensionReply(
			(method, params) => this.request(method, params),
			agent,
			reply,
		);
	}
	focus(agent: PaneInfo, request: FocusRequest): Promise<unknown> {
		if (this.core instanceof RemoteCoreEndpoint)
			return remoteExec(this.core.host, this.core.machine, {
				op: "focus",
				agent,
				focus: request,
			});
		return sendPeerFocus(
			(method, params) => this.request(method, params),
			agent,
			request,
		);
	}
	async openFocusChannel(
		agent: PaneInfo,
		request: FocusRequest,
	): Promise<PeerChannel> {
		this.lifetime.signal.throwIfAborted();
		const channel =
			this.core instanceof RemoteCoreEndpoint
				? await openCoreFocusChannel(
						this.core.host,
						this.socketPath,
						this.core.machine,
						agent,
						request,
						{ signal: this.lifetime.signal },
					)
				: await openPeerChannel(
						(method, params) => this.request(method, params),
						agent,
						request,
					);
		if (this.lifetime.signal.aborted) {
			channel.close();
			this.lifetime.signal.throwIfAborted();
		}
		this.focusChannels.add(channel);
		channel.onClose(() => this.focusChannels.delete(channel));
		return channel;
	}
	async request<T>(
		method: string,
		params: object = {},
		timeoutMs = 30_000,
	): Promise<T> {
		return (await dispatchCoreRequest(
			this.core,
			method,
			object(params),
			timeoutMs,
		)) as T;
	}

	async subscribe(
		_subscriptions: object[],
		onEvent: (event: HerdrEvent) => void,
		onDisconnect: (error?: Error) => void,
		signal?: AbortSignal,
	): Promise<() => void> {
		let closed = false;
		const subscription = await this.core.subscribe(
			{},
			(notification) => {
				if (notification.method !== "heartbeat")
					onEvent({ event: "core.reconcile", data: {} });
			},
			{ ...(signal ? { signal } : {}) },
		);
		void subscription.closed.then((error) => {
			if (!closed && !signal?.aborted) onDisconnect(error);
		});
		return () => {
			closed = true;
			subscription.close();
		};
	}
}
