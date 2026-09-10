import { randomBytes } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { sendPolicyMessage, startPreparedIdleTurn } from "./delivery.js";
import { getCurrentPane } from "./herdr.js";
import { HerdrClient } from "./herdr-client.js";
import {
	MAX_PEER_FRAME_BYTES,
	peerInboxPath,
} from "./remote/shepherdr-peer.mjs";

export function registerPeerInbox(pi: ExtensionAPI): void {
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
		close = await openInbox(pi, ctx, () => running);
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
): Promise<() => Promise<void>> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile)
		throw new Error("Shepherdr peer delivery requires a saved Pi session");
	const pane = await getCurrentPane(new HerdrClient());
	const token = randomBytes(32).toString("hex");
	const path = peerInboxPath(sessionFile, pane.terminal_id);
	const temporary = `${path}.${token}.tmp`;
	const sockets = new Set<Socket>();
	let active = true;
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.setEncoding("utf8");
		socket.setTimeout(10_000, () => socket.destroy());
		socket.on("error", () => socket.destroy());
		socket.on("close", () => sockets.delete(socket));
		let buffer = "";
		let received = false;
		socket.on("data", (chunk: string) => {
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
			const reply = (value: object) =>
				socket.end(
					`${JSON.stringify({ protocol: 1, id: request["id"], ...value })}\n`,
				);
			if (
				!active ||
				request["protocol"] !== 1 ||
				request["token"] !== token ||
				request["sessionFile"] !== sessionFile ||
				request["terminalId"] !== pane.terminal_id ||
				ctx.sessionManager.getSessionFile() !== sessionFile ||
				typeof request["id"] !== "string" ||
				typeof request["text"] !== "string" ||
				!request["text"].trim()
			) {
				reply({
					ok: false,
					rejected: true,
					error: "Peer delivery rejected: stale session or invalid request",
				});
				return;
			}
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
				sendPolicyMessage(
					pi,
					{
						customType: "herdr-agent-message",
						content: request["text"],
						display: true,
					},
					idle
						? { triggerTurn: false, deliverAs: "steer" }
						: { deliverAs: "steer" },
				);
				// Appending then claiming the shared kickoff also coalesces arrivals
				// during async preparation, when Pi still reports itself idle.
				if (idle) startPreparedIdleTurn(pi, ctx);
				reply({ ok: true });
			} catch (error) {
				reply({
					ok: false,
					rejected: false,
					error: `Peer delivery failed; inspect the target before retrying: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		});
	});
	server.maxConnections = 16;
	const stop = async () => {
		if (!active) return;
		active = false;
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
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
			JSON.stringify({ protocol: 1, port: address.port, token }),
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
