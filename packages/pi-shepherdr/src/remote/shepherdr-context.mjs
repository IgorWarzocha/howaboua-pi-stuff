// @howaboua/pi-shepherdr managed bridge
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readReceiver } from "./shepherdr-peer.mjs";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT = 35_000;

function contextDirectory() {
	return join(
		process.env["PI_CODING_AGENT_DIR"] || join(homedir(), ".pi", "agent"),
		"shepherdr",
		"context",
	);
}

/** @param {string} threadId @param {string} routeId */
export function relayContextPath(threadId, routeId) {
	if (typeof threadId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(threadId))
		throw new Error("Invalid context thread ID");
	if (typeof routeId !== "string" || !/^[a-f0-9]{32}$/.test(routeId))
		throw new Error("Invalid context route ID");
	return join(contextDirectory(), `relay-${routeId}-${threadId}.json`);
}

/** @param {string} sessionFile */
export function sessionContextPath(sessionFile) {
	return `${sessionFile}.shepherdr-context.json`;
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
	return error instanceof Error && "code" in error && error.code === code;
}

/** Local authenticated RPC; SSH helpers relay over their existing connection.
 * @param {string} path @param {unknown} request @param {AbortSignal} [signal]
 * @returns {Promise<unknown>} */
export async function requestContext(path, request, signal) {
	signal?.throwIfAborted();
	let descriptor;
	try {
		descriptor = JSON.parse(await readReceiver(path));
	} catch (error) {
		throw new Error(
			"Shared context owner is unavailable; resume it and reconnect its machine",
			{ cause: error },
		);
	}
	if (
		descriptor.protocol !== 1 ||
		!Number.isInteger(descriptor.port) ||
		descriptor.port < 1 ||
		descriptor.port > 65535 ||
		typeof descriptor.token !== "string" ||
		!/^[a-f0-9]{64}$/.test(descriptor.token)
	)
		throw new Error("Invalid shared context receiver");
	const id = randomUUID();
	const frame = `${JSON.stringify({ protocol: 1, id, token: descriptor.token, request })}\n`;
	if (Buffer.byteLength(frame) > MAX_BYTES)
		throw new Error("Shared context request is too large");
	return new Promise((resolve, reject) => {
		let attempted = false;
		let settled = false;
		let buffer = "";
		const socket = createConnection({
			host: "127.0.0.1",
			port: descriptor.port,
		});
		/** @param {Error} [error] @param {unknown} [result] */
		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", failed);
			socket.destroy();
			if (error) reject(error);
			else resolve(result);
		};
		const failed = () =>
			finish(
				new Error(
					attempted
						? "Shared context response was lost; a write may have completed. Reread the note before retrying"
						: "Shared context owner is unavailable; resume it and reconnect its machine",
				),
			);
		const timer = setTimeout(failed, TIMEOUT);
		timer.unref();
		signal?.addEventListener("abort", failed, { once: true });
		if (signal?.aborted) {
			failed();
			return;
		}
		socket.setEncoding("utf8");
		socket.on("error", failed);
		socket.on("close", failed);
		socket.on("connect", () => {
			attempted = true;
			socket.write(frame);
		});
		socket.on("data", (chunk) => {
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_BYTES) {
				failed();
				return;
			}
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			try {
				const value = JSON.parse(buffer.slice(0, newline));
				if (value.protocol !== 1 || value.id !== id) {
					failed();
					return;
				}
				if (value.ok === true) finish(undefined, value.result);
				else if (value.ok === false && typeof value.error === "string")
					finish(new Error(value.error));
				else failed();
			} catch {
				failed();
			}
		});
	});
}

/** @param {string} path @param {(request: unknown, signal: AbortSignal) => Promise<unknown>} handle */
export async function listenContext(path, handle) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	try {
		const previous = JSON.parse(await readFile(path, "utf8"));
		if (Number.isInteger(previous.pid)) {
			let alive = true;
			try {
				process.kill(previous.pid, 0);
			} catch (error) {
				if (hasCode(error, "ESRCH")) alive = false;
				else throw error;
			}
			if (alive)
				throw new Error(
					"This shared context session is already open; close its other live owner first",
				);
		}
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
	const token = randomBytes(32).toString("hex");
	const sockets = new Set();
	const server = createServer((socket) => {
		sockets.add(socket);
		const controller = new AbortController();
		let buffer = "";
		let received = false;
		socket.setEncoding("utf8");
		socket.setTimeout(TIMEOUT, () => socket.destroy());
		socket.on("error", () => socket.destroy());
		socket.on("close", () => {
			sockets.delete(socket);
			controller.abort();
		});
		socket.on("data", (chunk) => {
			if (received) return;
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_BYTES) {
				socket.destroy();
				return;
			}
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			received = true;
			let value;
			try {
				value = JSON.parse(buffer.slice(0, newline));
			} catch {
				socket.destroy();
				return;
			}
			if (
				value?.protocol !== 1 ||
				value.token !== token ||
				typeof value.id !== "string"
			) {
				socket.destroy();
				return;
			}
			/** @param {object} data */
			const reply = (data) => {
				const frame = `${JSON.stringify({ protocol: 1, id: value.id, ...data })}\n`;
				if (Buffer.byteLength(frame) > MAX_BYTES)
					socket.end(
						`${JSON.stringify({ protocol: 1, id: value.id, ok: false, error: "Shared context response is too large" })}\n`,
					);
				else socket.end(frame);
			};
			void Promise.resolve()
				.then(() => handle(value.request, controller.signal))
				.then(
					(result) => reply({ ok: true, result }),
					(error) =>
						reply({
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						}),
				);
		});
	});
	server.maxConnections = 16;
	const temporary = `${path}.${token}.tmp`;
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve) => server.close(resolve));
		try {
			if (JSON.parse(await readFile(path, "utf8")).token === token)
				await unlink(path);
		} catch (error) {
			if (!hasCode(error, "ENOENT")) throw error;
		}
	};
	try {
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve(undefined);
			});
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Shared context receiver has no address");
		await writeFile(
			temporary,
			JSON.stringify({
				protocol: 1,
				port: address.port,
				token,
				pid: process.pid,
			}),
			{ flag: "wx", mode: 0o600 },
		);
		await rename(temporary, path);
		server.on("error", () => {
			for (const socket of sockets) socket.destroy();
		});
		return close;
	} catch (error) {
		await unlink(temporary).catch((failure) => {
			if (failure.code !== "ENOENT") throw failure;
		});
		await close();
		throw error;
	}
}
