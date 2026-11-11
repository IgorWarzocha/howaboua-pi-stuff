#!/usr/bin/env node
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import {
	readAdmissionStart,
	releaseAdmissionStart,
} from "./admission-owner.mjs";

export const LANE_LIMITS = Object.freeze({ launch: 4, bulk: 8 });
export const MAX_FRAME_BYTES = 8 * 1024;
export const MAX_CLIENT_REQUESTS = 64;
export const MAX_REQUESTS = 1024;

/** @typedef {'launch' | 'bulk'} Lane */
/** @typedef {{lane: Lane, active: boolean}} Permit */
/** @typedef {{socket: import('node:net').Socket, requests: Map<string, Permit>, queues: Record<Lane, string[]>}} Client */
/** @typedef {{active: number, ready: Client[]}} LaneState */

/** The caller owns the private directory and stale-socket recovery.
 * @param {string} socketPath
 * @param {()=>Promise<void>} [releaseStartup]
 */
export function startAdmissionBroker(
	socketPath,
	releaseStartup = async () => {},
) {
	/** @type {Set<Client>} */
	const clients = new Set();
	/** @type {Record<Lane, LaneState>} */
	const lanes = {
		launch: { active: 0, ready: [] },
		bulk: { active: 0, ready: [] },
	};
	let requests = 0;
	let stopping = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let idle;
	const server = createServer(connect);
	let starting = true;
	function started() {
		if (!starting) return;
		starting = false;
		void releaseStartup().catch(() => {
			process.exitCode = 1;
			stop();
		});
	}

	function stop() {
		if (stopping) return;
		stopping = true;
		started();
		clearTimeout(idle);
		for (const client of clients) client.socket.destroy();
		// net.Server owns unlinking its successfully bound Unix socket. Never
		// unlink by pathname here: a losing EADDRINUSE contender owns nothing.
		server.close();
	}

	/** @param {number} delay */
	function armIdle(delay) {
		clearTimeout(idle);
		idle = setTimeout(stop, delay);
	}

	/** @param {Client} client @param {object} response */
	function send(client, response) {
		const frame = `${JSON.stringify(response)}\n`;
		if (
			Buffer.byteLength(frame) > MAX_FRAME_BYTES ||
			client.socket.writableLength > MAX_FRAME_BYTES * MAX_CLIENT_REQUESTS
		) {
			client.socket.destroy();
			return;
		}
		client.socket.write(frame);
	}

	function drain() {
		if (stopping) return;
		for (const lane of /** @type {Lane[]} */ (["launch", "bulk"])) {
			const state = lanes[lane];
			while (state.active < LANE_LIMITS[lane] && state.ready.length) {
				const client = state.ready.shift();
				if (!client || client.socket.destroyed) continue;
				const id = client.queues[lane].shift();
				if (id === undefined) continue;
				const permit = client.requests.get(id);
				if (!permit) continue;
				permit.active = true;
				state.active++;
				if (client.queues[lane].length) state.ready.push(client);
				send(client, { id, state: "granted" });
			}
		}
	}

	/** @param {Client} client @param {string} id */
	function release(client, id) {
		const permit = client.requests.get(id);
		// Idempotent cleanup allows cancellation to race a normal release.
		if (!permit) return;
		client.requests.delete(id);
		requests--;
		const state = lanes[permit.lane];
		if (permit.active) state.active--;
		else {
			const queue = client.queues[permit.lane];
			queue.splice(queue.indexOf(id), 1);
			if (!queue.length)
				state.ready = state.ready.filter((entry) => entry !== client);
		}
	}

	/** @param {Client} client @param {Buffer} frame */
	function receive(client, frame) {
		const message = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(frame),
		);
		if (
			!message ||
			typeof message !== "object" ||
			Array.isArray(message) ||
			typeof message.id !== "string" ||
			!message.id ||
			!["acquire", "release", "cancel"].includes(message.op)
		)
			throw new Error("Invalid admission frame");
		if (message.op !== "acquire") {
			if (Object.keys(message).some((key) => key !== "id" && key !== "op"))
				throw new Error("Invalid cleanup frame");
			release(client, message.id);
			drain();
			return;
		}
		if (
			(message.lane !== "bulk" && message.lane !== "launch") ||
			Object.keys(message).some((key) => !["id", "op", "lane"].includes(key)) ||
			client.requests.has(message.id)
		)
			throw new Error("Invalid acquire frame");
		if (
			client.requests.size >= MAX_CLIENT_REQUESTS ||
			requests >= MAX_REQUESTS
		) {
			send(client, {
				id: message.id,
				state: "error",
				message: "Admission queue full",
			});
			return;
		}
		const lane = /** @type {Lane} */ (message.lane);
		client.requests.set(message.id, { lane, active: false });
		requests++;
		if (!client.queues[lane].length) lanes[lane].ready.push(client);
		client.queues[lane].push(message.id);
		drain();
	}

	/** @param {import('node:net').Socket} socket */
	function connect(socket) {
		if (stopping) return socket.destroy();
		clearTimeout(idle);
		/** @type {Client} */
		const client = {
			socket,
			requests: new Map(),
			queues: { launch: [], bulk: [] },
		};
		clients.add(client);
		let buffered = Buffer.alloc(0);
		socket.on("error", () => socket.destroy());
		socket.on("close", () => {
			clients.delete(client);
			for (const id of client.requests.keys()) release(client, id);
			drain();
			if (!clients.size && !stopping) armIdle(2000);
		});
		socket.on("data", (chunk) => {
			try {
				if (!Buffer.isBuffer(chunk)) throw new Error("Expected raw bytes");
				// Bound the partial frame, not the chunk: one read can hold many frames.
				let offset = 0;
				while (offset < chunk.length && !socket.destroyed) {
					const newline = chunk.indexOf(10, offset);
					const end = newline < 0 ? chunk.length : newline;
					if (buffered.length + end - offset + 1 > MAX_FRAME_BYTES)
						throw new Error("Admission frame too large");
					buffered = Buffer.concat([buffered, chunk.subarray(offset, end)]);
					if (newline < 0) break;
					receive(client, buffered);
					buffered = Buffer.alloc(0);
					offset = end + 1;
				}
			} catch {
				socket.destroy();
			}
		});
	}

	server.on("error", (error) => {
		process.exitCode = "code" in error && error.code === "EADDRINUSE" ? 0 : 1;
		stop();
	});
	server.on("close", () => {
		clearTimeout(idle);
		process.removeListener("SIGTERM", stop);
		process.removeListener("SIGINT", stop);
	});
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	try {
		server.listen(socketPath, () => {
			started();
			armIdle(5000);
		});
	} catch {
		process.exitCode = 1;
		stop();
	}
	return server;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const { endpoint, lease } = await readAdmissionStart();
		startAdmissionBroker(endpoint, () => releaseAdmissionStart(lease));
	} catch {
		process.exitCode = 1;
	}
}
