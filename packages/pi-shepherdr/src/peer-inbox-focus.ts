import type { Socket } from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { acceptFocus, readFocus } from "./agents-focus.js";
import type { AgentFleet } from "./fleet/index.js";
import { acceptFocusChannel } from "./peer-channel.js";
import {
	MAX_CHANNEL_FRAME_BYTES,
	socketChannel,
} from "./remote/shepherdr-channel.mjs";
import { PEER_PROTOCOL } from "./remote/shepherdr-peer.mjs";
import type { PaneInfo } from "./types.js";

/** Focus admission owns its duplex buffering; the inbox retains authenticated socket lifetime. */
export function receivePeerFocus(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	fleet: AgentFleet,
	pane: PaneInfo,
	socket: Socket,
	request: Record<string, unknown>,
	trailing: string,
	reply: (value: object, flushed?: () => void) => void,
): void {
	if (request["kind"] === "channel" && pane) {
		let focus;
		try {
			focus = readFocus(request["focus"]);
		} catch (error) {
			reply({ ok: false, rejected: true, error: String(error) });
			return;
		}
		// Hold outbound frames until the admission reply precedes them.
		const pending: unknown[] = [];
		let admitted = false;
		const channel = socketChannel(socket, trailing);
		const receiverChannel = {
			...channel,
			send(message: unknown) {
				const json = JSON.stringify(message);
				if (
					json === undefined ||
					Buffer.byteLength(json) > MAX_CHANNEL_FRAME_BYTES
				) {
					channel.close();
					throw new Error("Focus channel frame is too large or not JSON");
				}
				if (admitted) channel.send(message);
				else {
					pending.push(message);
					if (
						pending.length > 64 ||
						Buffer.byteLength(JSON.stringify(pending)) > 1024 * 1024
					) {
						channel.close();
						throw new Error(
							"Focus channel admission output exceeded its buffer",
						);
					}
				}
			},
		};
		void acceptFocusChannel(pi, receiverChannel, focus, ctx, pane).then(
			() => {
				try {
					socket.write(
						`${JSON.stringify({ protocol: PEER_PROTOCOL, id: request["id"], ok: true })}\n`,
					);
					admitted = true;
					for (const message of pending) channel.send(message);
					pending.length = 0;
				} catch {
					channel.close();
				}
			},
			(error: unknown) => {
				reply(
					{
						ok: false,
						rejected: true,
						error: error instanceof Error ? error.message : String(error),
					},
					() => channel.close(),
				);
			},
		);
		return;
	}
	if (request["kind"] === "focus" && pane) {
		try {
			if (readFocus(request["focus"]).voice === true)
				throw new Error(
					"Voice transfer was not admitted; retry using agents focus with voice:true",
				);
		} catch (error) {
			reply({ ok: false, rejected: true, error: String(error) });
			return;
		}
		socket.setTimeout(60_000, () => socket.destroy());
		void acceptFocus(pi, ctx, fleet, pane, request["focus"]).then(
			() => reply({ ok: true, command: false }),
			(error: unknown) =>
				reply({
					ok: false,
					rejected: !(error instanceof Error && "focusChanged" in error),
					error: error instanceof Error ? error.message : String(error),
				}),
		);
		return;
	}
}
