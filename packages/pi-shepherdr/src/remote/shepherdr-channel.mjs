// @howaboua/pi-shepherdr managed bridge
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { PEER_PROTOCOL, resolvePeerReceiver } from "./shepherdr-peer.mjs";

export const MAX_CHANNEL_FRAME_BYTES = 512 * 1024;
const MAX_CHANNEL_BUFFER_BYTES = 1024 * 1024;
const MAX_QUEUED_FRAMES = 64;

/**
 * @param {(message:unknown)=>void} write
 * @param {()=>void} end
 */
export function createBufferedChannel(write, end) {
	/** @type {Set<(message:unknown)=>void>} */
	const messages = new Set();
	/** @type {Set<(error:Error)=>void>} */
	const closes = new Set();
	/** @type {Error | undefined} */
	let error;
	/** @type {unknown[]} */
	let queued = [];
	let bytes = 0;
	/** @param {Error} reason */
	const fail = (reason) => {
		if (error) return;
		error = reason;
		queued = [];
		bytes = 0;
		end();
		for (const listener of closes) listener(reason);
		closes.clear();
		messages.clear();
	};
	/** @param {unknown} message */
	const measure = (message) => {
		const json = JSON.stringify(message);
		if (json === undefined || Buffer.byteLength(json) > MAX_CHANNEL_FRAME_BYTES)
			throw new Error("Focus channel frame is too large or not JSON");
		return Buffer.byteLength(json);
	};
	/** @type {import("../types.js").PeerChannel} */
	const channel = {
		send(message) {
			if (error) throw error;
			try {
				measure(message);
				write(message);
			} catch (cause) {
				const reason =
					cause instanceof Error ? cause : new Error(String(cause));
				fail(reason);
				throw reason;
			}
		},
		onMessage(listener) {
			if (error) return () => {};
			messages.add(listener);
			const pending = queued;
			queued = [];
			bytes = 0;
			try {
				for (const message of pending) listener(message);
			} catch (cause) {
				fail(cause instanceof Error ? cause : new Error(String(cause)));
			}
			return () => messages.delete(listener);
		},
		onClose(listener) {
			if (error) listener(error);
			else closes.add(listener);
			return () => closes.delete(listener);
		},
		close() {
			fail(new Error("Focus channel closed"));
		},
	};
	return {
		channel,
		fail,
		/** @param {unknown} message */
		receive(message) {
			if (error) return;
			try {
				const size = measure(message);
				if (!messages.size) {
					bytes += size;
					if (
						bytes > MAX_CHANNEL_BUFFER_BYTES ||
						queued.length >= MAX_QUEUED_FRAMES
					)
						throw new Error("Focus channel initial input exceeded its buffer");
					queued.push(message);
				} else for (const listener of messages) listener(message);
			} catch (cause) {
				fail(cause instanceof Error ? cause : new Error(String(cause)));
			}
		},
	};
}

/** @param {import("node:net").Socket} socket @param {string} [initial] */
export function socketChannel(socket, initial = "") {
	const state = createBufferedChannel(
		(message) => {
			const frame = `${JSON.stringify({ kind: "data", message })}\n`;
			if (
				socket.writableLength + Buffer.byteLength(frame) >
				MAX_CHANNEL_BUFFER_BYTES
			)
				throw new Error("Focus channel output exceeded its buffer");
			socket.write(frame);
		},
		() => socket.destroy(),
	);
	let buffer = "";
	/** @param {string} chunk */
	const consume = (chunk) => {
		buffer += chunk;
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (
				(newline < 0
					? Buffer.byteLength(buffer)
					: Buffer.byteLength(buffer.slice(0, newline))) >
				MAX_CHANNEL_FRAME_BYTES + 128
			)
				return state.fail(new Error("Focus channel frame is too large"));
			if (newline < 0) return;
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			try {
				const frame = JSON.parse(line);
				if (frame?.kind !== "data" || !("message" in frame))
					throw new Error("Invalid focus channel frame");
				state.receive(frame.message);
			} catch (error) {
				return state.fail(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
	};
	socket.setEncoding("utf8");
	socket.setTimeout(0);
	socket.on("data", consume);
	socket.on("error", (error) => state.fail(error));
	socket.on("close", () => state.fail(new Error("Focus channel disconnected")));
	if (initial) consume(initial);
	return state.channel;
}

/**
 * @param {(method:string, params:object)=>Promise<unknown>} request
 * @param {import("../types.js").PaneInfo} expected
 * @param {import("../types.js").FocusRequest} focus
 * @returns {Promise<import("../types.js").PeerChannel>}
 */
export async function openPeerChannel(request, expected, focus) {
	const { descriptor, sessionFile, agent } = await resolvePeerReceiver(
		request,
		expected,
		true,
	);
	const id = randomUUID();
	const frame = `${JSON.stringify({ protocol: PEER_PROTOCOL, kind: "channel", id, token: descriptor.token, sessionFile, terminalId: agent.terminal_id, focus })}\n`;
	if (Buffer.byteLength(frame) > MAX_CHANNEL_FRAME_BYTES)
		throw new Error("Focus channel request is too large");
	return new Promise((resolve, reject) => {
		const socket = createConnection({
			host: "127.0.0.1",
			port: descriptor.port,
		});
		let buffer = "";
		const timer = setTimeout(
			() =>
				fail(
					new Error(
						"Focus channel admission timed out; inspect destination before retrying",
					),
				),
			55_000,
		);
		/** @param {unknown} error */
		const fail = (error) => {
			cleanup();
			socket.destroy();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timer);
			socket.off("data", receive);
			socket.off("error", fail);
			socket.off("close", closed);
		};
		const closed = () =>
			fail(new Error("Focus channel closed before admission"));
		/** @param {string} chunk */
		const receive = (chunk) => {
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_CHANNEL_FRAME_BYTES)
				return fail(new Error("Focus channel admission frame is too large"));
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			try {
				const reply = JSON.parse(buffer.slice(0, newline));
				if (
					reply.protocol !== PEER_PROTOCOL ||
					reply.id !== id ||
					reply.ok !== true
				)
					throw new Error(reply.error || "Focus channel admission rejected");
				cleanup();
				resolve(socketChannel(socket, buffer.slice(newline + 1)));
			} catch (error) {
				fail(error);
			}
		};
		socket.setEncoding("utf8");
		socket.on("error", fail);
		socket.on("close", closed);
		socket.on("data", receive);
		socket.on("connect", () => socket.write(frame));
	});
}
