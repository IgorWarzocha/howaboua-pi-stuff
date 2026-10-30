import { randomBytes } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { coreIdentity, publishCoreSession } from "./core/registration.js";
import { dispatchExtensionReply } from "./extension-reply.js";
import type { AgentFleet } from "./fleet/index.js";
import { getAgent, getCurrentPane, sessionPath } from "./herdr.js";
import { HerdrClient } from "./herdr-client.js";
import type { createPeerCommands } from "./peer-commands.js";
import { PeerInboxDelivery } from "./peer-inbox-delivery.js";
import { receivePeerFocus } from "./peer-inbox-focus.js";
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
	let generation = 0;
	const publish = async (ctx: ExtensionContext) => {
		const core = coreIdentity(ctx);
		if (
			!core &&
			(process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"])
		)
			return;
		if (core) {
			await close?.();
			close = undefined;
		}
		close = await openInbox(
			pi,
			ctx,
			() => running,
			() => generation,
			commands,
			fleet,
			catchup,
		);
	};
	pi.on("before_agent_start", () => {
		generation += 1;
		running = true;
	});
	pi.on("agent_settled", () => {
		running = false;
	});
	pi.on("session_start", async () => {
		await close?.();
		close = undefined;
		running = false;
	});
	pi.on("resources_discover", async (_event, ctx) => publish(ctx));
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
	generation: () => number,
	commands: ReturnType<typeof createPeerCommands>,
	fleet: AgentFleet,
	catchup: (
		ctx: ExtensionContext,
	) => Promise<{ content: string; accepted: () => void }>,
): Promise<() => Promise<void>> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile)
		throw new Error("Shepherdr peer delivery requires a saved Pi session");
	const core = coreIdentity(ctx);
	const pane = core
		? {
				backend: "core" as const,
				pane_id: core.terminalId,
				terminal_id: core.terminalId,
				agent_status: "unknown" as const,
				agent_session: {
					agent: "pi",
					kind: "path" as const,
					source: "pi.session_file",
					value: sessionFile,
				},
			}
		: await getCurrentPane(new HerdrClient());
	const terminalId = pane.terminal_id;
	if (!terminalId)
		throw new Error("Shepherdr peer receiver has no terminal identity");
	const token = randomBytes(32).toString("hex");
	const path = peerInboxPath(sessionFile, terminalId);
	const temporary = `${path}.${token}.tmp`;
	const sockets = new Set<Socket>();
	let state: "open" | "quitting" | "closed" = "open";
	const delivery = new PeerInboxDelivery(
		sessionFile,
		isRunning,
		() => state === "open",
		(socket) => {
			state = "quitting";
			sockets.delete(socket);
			socket.setTimeout(0);
		},
		commands,
		catchup,
	);
	let clearCoreSession: (() => Promise<void>) | undefined;
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
				request["terminalId"] !== terminalId ||
				ctx.sessionManager.getSessionFile() !== sessionFile ||
				typeof request["id"] !== "string" ||
				(request["kind"] !== "focus" &&
					request["kind"] !== "commands" &&
					request["kind"] !== "message" &&
					request["kind"] !== "close-idle" &&
					request["kind"] !== "channel" &&
					request["kind"] !== "extension-reply") ||
				(request["kind"] !== "focus" &&
					request["kind"] !== "commands" &&
					request["kind"] !== "channel" &&
					request["kind"] !== "extension-reply" &&
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
			if (request["kind"] === "extension-reply") {
				const extension = request["extension"],
					id = request["messageId"],
					message = request["message"];
				if (
					typeof extension !== "string" ||
					!extension.trim() ||
					typeof id !== "string" ||
					!id.trim() ||
					typeof message !== "string"
				) {
					reply({
						ok: false,
						rejected: true,
						error: "Extension reply requires extension, id and message strings",
					});
					return;
				}
				// No agent turn, UI automation or idle/busy restriction: the producer owns delivery.
				socket.setTimeout(60_000, () => socket.destroy());
				try {
					const result = await dispatchExtensionReply(pi, {
						extension,
						id,
						message,
					});
					reply({ ok: true, command: false, result });
				} catch (error) {
					reply({
						ok: false,
						rejected: false,
						error: error instanceof Error ? error.message : String(error),
					});
				}
				return;
			}
			if (request["kind"] === "commands") {
				try {
					reply({ ok: true, command: false, commands: commands.available() });
				} catch (error) {
					reply({
						ok: false,
						rejected: true,
						error: error instanceof Error ? error.message : String(error),
					});
				}
				return;
			}
			if (request["kind"] === "close-idle" && pane) {
				const startGeneration = generation();
				const idle = (live: ExtensionContext) =>
					state === "open" &&
					!socket.destroyed &&
					live.sessionManager.getSessionFile() === sessionFile &&
					live.isIdle() &&
					!live.hasPendingMessages() &&
					!isRunning() &&
					delivery.pendingPrompts === 0 &&
					generation() === startGeneration;
				const reject = () =>
					reply({
						ok: false,
						rejected: true,
						error: "Target is busy or changed context; idle close skipped",
					});
				if (!idle(ctx)) {
					reject();
					return;
				}
				try {
					const livePane = await getAgent(
						core ? fleet.connected().client : new HerdrClient(),
						pane.pane_id,
					);
					if (
						request["text"] !== "/quit" ||
						!idle(ctx) ||
						livePane.pane_id !== pane.pane_id ||
						livePane.terminal_id !== pane.terminal_id ||
						sessionPath(livePane) !== sessionFile ||
						livePane.interactive_ready !== true ||
						livePane.launch_pending === true ||
						(livePane.agent_status !== "idle" &&
							livePane.agent_status !== "done")
					) {
						reject();
						return;
					}
					commands.closeIdle(ctx, async (live) => {
						if (!idle(live)) {
							reject();
							return;
						}
						// No async boundary between the live idle check and shutdown.
						// Retain the socket until process exit, as for ordinary peer quit.
						state = "quitting";
						sockets.delete(socket);
						socket.setTimeout(0);
						socket.write(
							`${JSON.stringify({ protocol: PEER_PROTOCOL, id: request["id"], ok: true, command: true, closing: true })}\n`,
						);
						live.shutdown();
					});
				} catch {
					reject();
				}
				return;
			}
			if (
				(request["kind"] === "channel" || request["kind"] === "focus") &&
				pane
			) {
				receivePeerFocus(
					pi,
					ctx,
					fleet,
					pane,
					socket,
					request,
					buffer.slice(newline + 1),
					reply,
				);
				return;
			}
			await delivery.receive(pi, ctx, socket, request, reply);
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
		} finally {
			await clearCoreSession?.();
			clearCoreSession = undefined;
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
		if (core) clearCoreSession = await publishCoreSession(core, sessionFile);
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
