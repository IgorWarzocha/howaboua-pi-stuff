import type { HerdrConnection } from "../herdr-client.js";
import type { SshMachine } from "../machine-catalog.js";
import type { AssistantReader } from "../session-reader.js";
import type {
	LatestAssistant,
	PaneInfo,
	PeerDelivery,
	PeerMessage,
	SessionView,
} from "../types.js";
import { connectRemoteBridge } from "./deployment.js";
import { readPeerCommands } from "./shepherdr-peer.mjs";
import { RemoteTransport } from "./transport.js";

/** Operation-specific RPC shapes and responses; transport owns all live resources. */
export class RemoteHerdrClient
	extends RemoteTransport
	implements HerdrConnection, AssistantReader
{
	static async connect(
		config: SshMachine,
		onClose: (error: Error) => void,
	): Promise<RemoteHerdrClient> {
		const child = await connectRemoteBridge(config);
		const client = new RemoteHerdrClient(child, onClose);
		try {
			await client.ready();
			return client;
		} catch (error) {
			client.close();
			throw error;
		}
	}

	async request<T>(
		method: string,
		params: object = {},
		timeoutMs = 10_000,
	): Promise<T> {
		return (await this.call(
			{ op: "request", method, params, timeoutMs },
			timeoutMs + 1_000,
		)) as T;
	}

	async replyExtension(
		agent: PaneInfo,
		reply: import("../types.js").ExtensionReply,
	): Promise<string> {
		const result = await this.call(
			{ op: "extension-reply", agent, reply },
			60_000,
		);
		if (typeof result !== "string")
			throw new Error(
				"Invalid extension reply receipt; inspect the target before retrying",
			);
		return result;
	}

	async commands(
		agent: PaneInfo,
	): Promise<import("../types.js").PeerCommand[]> {
		const result = await this.call({ op: "commands", agent }, 26_000);
		return readPeerCommands(result);
	}

	async sendMessage(
		agent: PaneInfo,
		message: PeerMessage,
	): Promise<PeerDelivery> {
		const result = await this.call(
			{ op: "message", agent, message },
			message.text.trim() === "/quit" ? 0 : 26_000,
		);
		if (
			!result ||
			typeof result !== "object" ||
			!("command" in result) ||
			typeof result.command !== "boolean"
		)
			throw new Error(
				"Invalid peer acknowledgement; inspect the target before retrying",
			);
		return { command: result.command };
	}

	async machineIdentity(): Promise<import("../types.js").MachineIdentity> {
		const result = await this.call({ op: "identity" });
		if (
			!result ||
			typeof result !== "object" ||
			!("host" in result) ||
			typeof result.host !== "string" ||
			!("session" in result) ||
			typeof result.session !== "string"
		)
			throw new Error("Could not identify remote Herdr session");
		return { host: result.host, session: result.session };
	}

	focus(
		agent: PaneInfo,
		request: import("../types.js").FocusRequest,
	): Promise<unknown> {
		return this.call({ op: "focus", agent, request }, 60_000);
	}

	async latest(path?: string): Promise<LatestAssistant | undefined> {
		return (await this.view(path)).assistant;
	}

	async view(path?: string): Promise<SessionView> {
		return (await this.call({ op: "view", path })) as SessionView;
	}

	async keybindings(): Promise<Record<string, unknown>> {
		return (await this.call({ op: "keybindings" })) as Record<string, unknown>;
	}

	async directory(
		value: string | undefined,
		fallback: string,
	): Promise<string> {
		return (await this.call({ op: "directory", value, fallback })) as string;
	}
}
