import { randomBytes } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { acceptFocus, readFocus } from "./agents-focus.js";
import { sendPolicyMessage, startPreparedIdleTurn } from "./delivery.js";
import type { AgentFleet } from "./fleet.js";
import { getCurrentPane } from "./herdr.js";
import { HerdrClient } from "./herdr-client.js";
import { announcePeerMessage } from "./messages.js";
import { acceptFocusChannel } from "./peer-channel.js";
import type { createPeerCommands } from "./peer-commands.js";
import {
	MAX_CHANNEL_FRAME_BYTES,
	socketChannel,
} from "./remote/shepherdr-channel.mjs";
import {
	MAX_PEER_FRAME_BYTES,
	PEER_PROTOCOL,
	peerInboxPath,
} from "./remote/shepherdr-peer.mjs";

export function registerPeerInbox(
	pi: ExtensionAPI,
	commands: ReturnType<typeof createPeerCommands>,
	fleet: AgentFleet,
	catchup: (
		ctx: ExtensionContext,
	) => Promise<{ content: string; accepted: () => void }>,
): void {
	let close: (() => Promise<void>) | undefined;
	let running = false;
	pi.on("agent_start", () => {
		running = true;
	});
	pi.on("agent_settled", () => {
		running = false;
	});
	pi.on("session_start", async (_event, ctx) => {
		await close?.();
		close = undefined;
		running = false;
		if (process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"])
			return;
		close = await openInbox(pi, ctx, () => running, commands, fleet, catchup);
	});
	pi.on("session_shutdown", async () => {
		await close?.();
		close = undefined;
		running = false;
	});
}

async function openInbox(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	isRunning: () => boolean,
	commands: ReturnType<typeof createPeerCommands>,
	fleet: AgentFleet,
	catchup: (
		ctx: ExtensionContext,
	) => Promise<{ content: string; accepted: () => void }>,
): Promise<() => Promise<void>> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile)
		throw new Error("Shepherdr peer delivery requires a saved Pi session");
	const pane = await getCurrentPane(new HerdrClient());
	const token = randomBytes(32).toString("hex");
	const path = peerInboxPath(sessionFile, pane.terminal_id);
	const temporary = `${path}.${token}.tmp`;
	const sockets = new Set<Socket>();
	let state: "open" | "quitting" | "closed" = "open";
	let promptDelivery = Promise.resolve();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.setEncoding("utf8");
		socket.setTimeout(10_000, () => socket.destroy());
		socket.on("error", () => socket.destroy());
		socket.on("close", () => sockets.delete(socket));
		let buffer = "";
		let received = false;
		socket.on("data", async (chunk: string) => {
			if (received) return;
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_PEER_FRAME_BYTES) {
				socket.destroy();
				return;
			}
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			received = true;
			let request: Record<string, unknown>;
			try {
				const value: unknown = JSON.parse(buffer.slice(0, newline));
				if (!value || typeof value !== "object" || Array.isArray(value))
					throw new Error("Invalid request");
				request = value as Record<string, unknown>;
			} catch {
				socket.destroy();
				return;
			}
			const reply = (value: object, flushed?: () => void) =>
				socket.end(
					`${JSON.stringify({ protocol: PEER_PROTOCOL, id: request["id"], ...value })}\n`,
					flushed,
				);
			if (
				state !== "open" ||
				request["protocol"] !== PEER_PROTOCOL ||
				request["token"] !== token ||
				request["sessionFile"] !== sessionFile ||
				request["terminalId"] !== pane.terminal_id ||
				ctx.sessionManager.getSessionFile() !== sessionFile ||
				typeof request["id"] !== "string" ||
				(request["kind"] !== "focus" &&
					request["kind"] !== "message" &&
					request["kind"] !== "channel") ||
				(request["kind"] !== "focus" &&
					request["kind"] !== "channel" &&
					(typeof request["text"] !== "string" ||
						!request["text"].trim() ||
						typeof request["sender"] !== "string" ||
						!/^<herdr_sender [^\n]+ \/>$/.test(request["sender"]) ||
						(request["context"] !== undefined &&
							typeof request["context"] !== "string")))
			) {
				reply({
					ok: false,
					rejected: true,
					error: "Peer delivery rejected: stale session or invalid request",
				});
				return;
			}
			if (request["kind"] === "channel") {
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
				const channel = socketChannel(socket, buffer.slice(newline + 1));
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
			if (request["kind"] === "focus") {
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
			let submitted = false;
			try {
				const idle = ctx.isIdle();
				// Manual compaction/tree navigation can be busy without an agent
				// loop to consume steering. Do not acknowledge a stranded message.
				if (!idle && !isRunning()) {
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
					const route = commands.prepare(text, ctx);
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
							state = "quitting";
							sockets.delete(socket);
							socket.setTimeout(0);
							socket.write(
								`${JSON.stringify({ protocol: PEER_PROTOCOL, id: request["id"], ok: true, command, closing: true })}\n`,
								execute,
							);
						} else reply({ ok: true, command }, execute);
						return;
					}
					if (idle && !command) startPreparedIdleTurn(pi, ctx, submit);
					else submit();
					reply({ ok: true, command });
					return;
				}
				// Catch-up sampling and acceptance form one prompt boundary, including
				// bursts arriving on separate authenticated sockets.
				const previous = promptDelivery;
				let release!: () => void;
				promptDelivery = new Promise<void>((resolve) => {
					release = resolve;
				});
				await previous;
				try {
					const notice = await catchup(ctx);
					if (
						state !== "open" ||
						ctx.sessionManager.getSessionFile() !== sessionFile ||
						(!ctx.isIdle() && !isRunning())
					) {
						reply({
							ok: false,
							rejected: true,
							error: "Target changed context; retry after it settles",
						});
						return;
					}
					const promptIdle = ctx.isIdle();
					submitted = true;
					sendPolicyMessage(
						pi,
						{
							customType: "herdr-agent-message",
							content: `${sender}\n${text}${notice.content}`,
							display: true,
						},
						promptIdle
							? { triggerTurn: false, deliverAs: "nextTurn" }
							: { deliverAs: "steer" },
					);
					notice.accepted();
					// Keep arrivals out of history until idle rollover and preparation
					// finish. The shared kickoff coalesces arrivals during preparation.
					if (promptIdle) startPreparedIdleTurn(pi, ctx);
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
					release();
				}
			} catch (error) {
				reply({
					ok: false,
					rejected: !submitted,
					error: `${submitted ? "Peer delivery failed; inspect the target before retrying" : "Peer delivery rejected"}: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		});
	});
	server.maxConnections = 16;
	const stop = async () => {
		if (state === "closed") return;
		const quitting = state === "quitting";
		state = "closed";
		for (const socket of sockets) socket.destroy();
		const closed = new Promise<void>((resolve) =>
			server.close(() => resolve()),
		);
		if (!quitting) await closed;
		try {
			const current: unknown = JSON.parse(await readFile(path, "utf8"));
			if (
				current &&
				typeof current === "object" &&
				"token" in current &&
				current.token === token
			)
				await unlink(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	};
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
		server.on("error", (error) => {
			ctx.ui.notify(
				`Shepherdr peer receiver failed: ${error.message}`,
				"error",
			);
			void stop().catch((failure: unknown) =>
				ctx.ui.notify(String(failure), "error"),
			);
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Shepherdr peer receiver has no address");
		await writeFile(
			temporary,
			JSON.stringify({ protocol: PEER_PROTOCOL, port: address.port, token }),
			{ mode: 0o600, flag: "wx" },
		);
		await rename(temporary, path);
	} catch (error) {
		try {
			await unlink(temporary).catch((failure: NodeJS.ErrnoException) => {
				if (failure.code !== "ENOENT") throw failure;
			});
		} finally {
			await stop();
		}
		throw error;
	}
	return stop;
}
