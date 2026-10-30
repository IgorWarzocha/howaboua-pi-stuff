import type { Socket } from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { sendPolicyMessage } from "./delivery.js";
import { announcePeerMessage } from "./messages/voice-announcements.js";
import type { createPeerCommands } from "./peer-commands.js";
import { PEER_PROTOCOL } from "./remote/shepherdr-peer.mjs";

/** Serialises prompt catch-up/acceptance, but never serialises lifecycle commands. */
export class PeerInboxDelivery {
	private promptDelivery = Promise.resolve();
	pendingPrompts = 0;

	private readonly sessionFile: string;
	private readonly isRunning: () => boolean;
	private readonly isOpen: () => boolean;
	private readonly quitting: (socket: Socket) => void;
	private readonly commands: ReturnType<typeof createPeerCommands>;
	private readonly catchup: (
		ctx: ExtensionContext,
	) => Promise<{ content: string; accepted: () => void }>;
	constructor(
		sessionFile: string,
		isRunning: () => boolean,
		isOpen: () => boolean,
		quitting: (socket: Socket) => void,
		commands: ReturnType<typeof createPeerCommands>,
		catchup: (
			ctx: ExtensionContext,
		) => Promise<{ content: string; accepted: () => void }>,
	) {
		this.sessionFile = sessionFile;
		this.isRunning = isRunning;
		this.isOpen = isOpen;
		this.quitting = quitting;
		this.commands = commands;
		this.catchup = catchup;
	}

	async receive(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		socket: Socket,
		request: Record<string, unknown>,
		reply: (value: object, flushed?: () => void) => void,
	): Promise<void> {
		let submitted = false;
		try {
			const idle = ctx.isIdle();
			// Manual compaction/tree navigation can be busy without an agent
			// loop to consume steering. Do not acknowledge a stranded message.
			if (!idle && !this.isRunning()) {
				reply({
					ok: false,
					rejected: true,
					error: "Target is changing context; retry after it settles",
				});
				return;
			}
			const text = request["text"] as string;
			const sender = request["context"]
				? `${request["sender"]}\n${request["context"]}`
				: (request["sender"] as string);
			if (text.startsWith("/")) {
				const route = this.commands.prepare(text, ctx);
				const { command } = route;
				const submit = () => {
					submitted = true;
					sendPolicyMessage(
						pi,
						{
							customType: "herdr-agent-source",
							content: sender,
							display: true,
						},
						{
							triggerTurn: false,
							deliverAs: idle && !command ? "nextTurn" : "steer",
						},
					);
					route.submit();
				};
				if (command) {
					// Lifecycle commands can tear down this inbox. Flush acceptance first.
					const execute = () => {
						try {
							submit();
						} catch (error) {
							ctx.ui.notify(
								`Command submission failed: ${String(error)}`,
								"error",
							);
						}
					};
					if (text.trim() === "/quit") {
						// Hold this authenticated connection until process exit, not
						// session_shutdown (which precedes Pi's runtime teardown).
						this.quitting(socket);
						socket.write(
							`${JSON.stringify({ protocol: PEER_PROTOCOL, id: request["id"], ok: true, command, closing: true })}\n`,
							execute,
						);
					} else reply({ ok: true, command }, execute);
					return;
				}
				submit();
				reply({ ok: true, command });
				return;
			}
			// Catch-up sampling and acceptance form one prompt boundary, including
			// bursts arriving on separate authenticated sockets.
			const previous = this.promptDelivery;
			this.pendingPrompts += 1;
			let release!: () => void;
			this.promptDelivery = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			try {
				const notice = await this.catchup(ctx);
				if (
					!this.isOpen() ||
					ctx.sessionManager.getSessionFile() !== this.sessionFile ||
					(!ctx.isIdle() && !this.isRunning())
				) {
					reply({
						ok: false,
						rejected: true,
						error: "Target changed context; retry after it settles",
					});
					return;
				}
				submitted = true;
				sendPolicyMessage(
					pi,
					{
						customType: "herdr-agent-message",
						content: `${sender}\n${text}${notice.content}`,
						display: true,
					},
					{ triggerTurn: true, deliverAs: "steer" },
				);
				notice.accepted();
				// Voice failure must not turn accepted delivery into a retry.
				try {
					announcePeerMessage(pi, {
						sender: request["sender"] as string,
						text,
					});
				} catch (error) {
					ctx.ui.notify(
						`Peer voice update failed: ${String(error)}`,
						"warning",
					);
				}
				reply({ ok: true, command: false });
			} finally {
				this.pendingPrompts -= 1;
				release();
			}
		} catch (error) {
			reply({
				ok: false,
				rejected: !submitted,
				error: `${submitted ? "Peer delivery failed; inspect the target before retrying" : "Peer delivery rejected"}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
}
