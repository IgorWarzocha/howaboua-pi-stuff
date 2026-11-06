import { hostname } from "node:os";
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
	PaneInfo,
	PeerChannel,
	PeerMessage,
} from "../types.js";
import { CoreClient } from "./client.js";
import { openCoreFocusChannel } from "./focus-channel.js";
import type { CoreMachine } from "./machines.js";
import { object } from "./protocol.js";
import { RemoteCoreEndpoint } from "./remote-endpoint.js";
import { CoreRemoteReader } from "./remote-reader.js";
import { terminalPeer } from "./terminal-peer.mjs";

export class CoreConnection {
	private readonly peer = terminalPeer((method, params) =>
		this.core.request(method, params),
	);
	private readonly lifetime = new AbortController();
	private readonly focusChannels = new Set<PeerChannel>();
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
		this.core.close();
	}
	async machineIdentity() {
		const hello = object(await this.core.request("hello"));
		const version =
			typeof hello["version"] === "string"
				? /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(hello["version"])
				: null;
		if (
			!version ||
			!(
				Number(version[1]) > 0 ||
				Number(version[2]) > 1 ||
				(Number(version[2]) === 1 && Number(version[3]) >= 18)
			)
		)
			throw new Error(
				"Shepherdr requires Herdr Core 0.1.18 or newer; update Core on this machine and reconnect",
			);
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
			return this.core.call(
				{ op: "context", path, request },
				{ timeoutMs: 36_000, ...(signal ? { signal } : {}) },
			);
		return requestContext(path, request, signal);
	}
	async readSavedSession(
		path: string,
		history: boolean,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (this.core instanceof RemoteCoreEndpoint)
			return this.core.call(
				{ op: "saved_session", path, history },
				{ ...(signal ? { signal } : {}) },
			);
		const { readSavedNotesSession } = await import(
			"@howaboua/pi-notes-compaction/saved-session"
		);
		return readSavedNotesSession(path, signal, history);
	}
	async startContextRelay(
		threadId: string,
		_routeId: string,
		handler: (request: unknown, signal: AbortSignal) => Promise<unknown>,
		onFailure: (error: Error) => void = () => {},
	): Promise<void> {
		if (!(this.core instanceof RemoteCoreEndpoint))
			throw new Error("Local context routes use the controller session");
		this.lifetime.signal.throwIfAborted();
		await this.core.bridge.startContextRelay(threadId, handler, onFailure);
	}
	contextRelayPath(): string {
		if (!(this.core instanceof RemoteCoreEndpoint))
			throw new Error(
				"Shared context relay is unavailable; open /herdr → Status to retry sharing",
			);
		return this.core.bridge.contextRelayPath();
	}
	async directory(
		value: string | undefined,
		fallback: string,
	): Promise<string> {
		if (!(this.core instanceof RemoteCoreEndpoint))
			throw new Error("Use local directory resolution on the local Core");
		const result = await this.core.call({
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
				await this.core.call(
					{
						op: "message",
						agent,
						message,
					},
					{ timeoutMs: message.text.trim() === "/quit" ? 0 : 36_000 },
				),
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
		return sendPeerMessage(this.peer, agent, message);
	}
	async commands(agent: PaneInfo) {
		if (this.core instanceof RemoteCoreEndpoint)
			return readPeerCommands(
				await this.core.call({
					op: "commands",
					agent,
				}),
			);
		return sendPeerCommands(this.peer, agent);
	}
	async replyExtension(agent: PaneInfo, reply: ExtensionReply) {
		if (this.core instanceof RemoteCoreEndpoint) {
			const result = await this.core.call(
				{
					op: "reply",
					agent,
					reply,
				},
				{ timeoutMs: 60_000 },
			);
			if (typeof result !== "string")
				throw new Error(
					"Remote extension reply was not acknowledged; inspect the target before retrying",
				);
			return result;
		}
		return sendPeerExtensionReply(this.peer, agent, reply);
	}
	focus(agent: PaneInfo, request: FocusRequest): Promise<unknown> {
		if (this.core instanceof RemoteCoreEndpoint)
			return this.core.call(
				{
					op: "focus",
					agent,
					focus: request,
				},
				{ timeoutMs: 60_000 },
			);
		return sendPeerFocus(this.peer, agent, request);
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
				: await openPeerChannel(this.peer, agent, request);
		if (this.lifetime.signal.aborted) {
			channel.close();
			this.lifetime.signal.throwIfAborted();
		}
		this.focusChannels.add(channel);
		channel.onClose(() => this.focusChannels.delete(channel));
		return channel;
	}
	async subscribe(
		targets: string[],
		onChange: () => void,
		onDisconnect: (error?: Error) => void,
		signal?: AbortSignal,
	): Promise<() => void> {
		let closed = false;
		const watched = new Set(targets);
		const subscription = await this.core.subscribe(
			{},
			(notification) => {
				if (
					notification.method === "snapshot" ||
					notification.method === "missed" ||
					(notification.method === "event" &&
						notification.event.terminal &&
						watched.has(notification.event.terminal))
				)
					onChange();
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
