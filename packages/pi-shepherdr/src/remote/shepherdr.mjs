// @howaboua/pi-shepherdr managed bridge
import { open, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const BRIDGE_VERSION = 1;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const subscriptions = new Map();
const assistantCache = new Map();

function argument(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function expandHome(path) {
	return path === "~"
		? homedir()
		: path.startsWith("~/")
			? join(homedir(), path.slice(2))
			: path;
}

function socketPath() {
	const explicit = argument("socket");
	if (explicit) return expandHome(explicit);
	const root = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	const session = argument("session");
	return session
		? join(root, "herdr", "sessions", session, "herdr.sock")
		: join(root, "herdr", "herdr.sock");
}

function send(value) {
	const frame = `${JSON.stringify(value)}\n`;
	if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
		throw new Error("Shepherdr bridge response is too large");
	}
	process.stdout.write(frame);
}

function responseError(value) {
	if (value && typeof value === "object" && typeof value.message === "string") {
		return {
			message: value.message,
			...(typeof value.code === "string" ? { code: value.code } : {}),
			herdrResponse: true,
		};
	}
	return {
		message: `Herdr request failed: ${JSON.stringify(value)}`,
		herdrResponse: true,
	};
}

function errorFromResponse(value) {
	const detail = responseError(value);
	return Object.assign(new Error(detail.message), detail);
}

function openHerdr(label, message, onValue, onDisconnect) {
	let buffer = "";
	let disconnected = false;
	const socket = createConnection(socketPath());
	const disconnect = (error) => {
		if (disconnected) return;
		disconnected = true;
		onDisconnect(error ?? new Error(`${label} disconnected`));
	};
	socket.setEncoding("utf8");
	socket.on("connect", () => socket.write(`${JSON.stringify(message)}\n`));
	socket.on("error", disconnect);
	socket.on("end", () => disconnect());
	socket.on("close", () => disconnect());
	socket.on("data", (chunk) => {
		buffer += chunk;
		if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) {
			disconnect(new Error(`${label} frame is too large`));
			socket.destroy();
			return;
		}
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (!line) continue;
			let value;
			try {
				value = JSON.parse(line);
			} catch (error) {
				disconnect(
					new Error(`${label} returned invalid JSON: ${error.message}`),
				);
				socket.destroy();
				return;
			}
			onValue(value);
		}
	});
	return socket;
}

function request(method, params = {}, timeoutMs = 10_000) {
	return new Promise((resolveRequest, reject) => {
		const id = `pi-shepherdr-bridge:${crypto.randomUUID()}`;
		let settled = false;
		let socket;
		const timer = setTimeout(
			() => finish(new Error(`Herdr ${method} timed out`)),
			timeoutMs,
		);
		timer.unref();
		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) reject(error);
			else resolveRequest(result);
		};
		socket = openHerdr(
			`Herdr ${method}`,
			{ id, method, params },
			(response) => {
				if (response.id !== id)
					finish(
						new Error(`Herdr ${method} returned a mismatched response ID`),
					);
				else if (response.error !== undefined)
					finish(errorFromResponse(response.error));
				else if (response.result !== undefined)
					finish(undefined, response.result);
				else finish(new Error(`Herdr ${method} returned no result`));
			},
			(error) => finish(error),
		);
	});
}

function subscribe(id, requested) {
	return new Promise((resolveSubscription, reject) => {
		const requestId = `pi-shepherdr-bridge:subscribe:${crypto.randomUUID()}`;
		let acknowledged = false;
		let closed = false;
		let socket;
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("Herdr events.subscribe timed out"));
		}, 10_000);
		timer.unref();
		const disconnected = (error) => {
			clearTimeout(timer);
			if (!acknowledged)
				reject(error ?? new Error("Herdr subscription disconnected"));
			else if (!closed) {
				process.stderr.write(
					`Herdr monitoring disconnected${error ? `: ${error.message}` : ""}\n`,
				);
				process.exitCode = 1;
				setTimeout(() => process.exit(), 0);
			}
		};
		socket = openHerdr(
			"Herdr events.subscribe",
			{
				id: requestId,
				method: "events.subscribe",
				params: { subscriptions: requested },
			},
			(value) => {
				if (!acknowledged && value.id === requestId) {
					if (value.error !== undefined) {
						disconnected(errorFromResponse(value.error));
						socket.destroy();
						return;
					}
					if (value.result?.type !== "subscription_started") {
						disconnected(
							new Error(
								"Herdr events.subscribe returned an invalid acknowledgement",
							),
						);
						socket.destroy();
						return;
					}
					acknowledged = true;
					clearTimeout(timer);
					subscriptions.set(id, () => {
						closed = true;
						socket.destroy();
					});
					resolveSubscription();
					return;
				}
				if (
					acknowledged &&
					typeof value.event === "string" &&
					value.data &&
					typeof value.data === "object"
				) {
					send({
						subscription: id,
						event: { event: value.event, data: value.data },
					});
				}
			},
			disconnected,
		);
	});
}

function assistantFromEntry(entry) {
	const message = entry.message;
	if (!message || typeof message !== "object" || message.role !== "assistant")
		return undefined;
	const text = [];
	if (typeof message.content === "string") text.push(message.content);
	else if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (
				part &&
				typeof part === "object" &&
				part.type === "text" &&
				typeof part.text === "string"
			)
				text.push(part.text);
		}
	}
	const joined = text.join("");
	const stopReason =
		typeof message.stopReason === "string" ? message.stopReason : undefined;
	if (!joined && stopReason !== "error") return undefined;
	return {
		id: entry.id,
		text: joined,
		...(stopReason ? { stopReason } : {}),
	};
}

async function latestAssistant(path, size) {
	const file = await open(path, "r");
	let targetId;
	const inspect = (line) => {
		if (line.length === 0) return undefined;
		let entry;
		try {
			entry = JSON.parse(line.toString("utf8"));
		} catch {
			return undefined;
		}
		if (typeof entry.id !== "string") return undefined;
		targetId ??= entry.id;
		if (entry.id !== targetId) return undefined;
		const assistant = assistantFromEntry(entry);
		if (assistant) return assistant;
		if (typeof entry.parentId !== "string") return null;
		targetId = entry.parentId;
		return undefined;
	};

	try {
		let position = size;
		let partial = Buffer.alloc(0);
		while (position > 0) {
			const length = Math.min(READ_CHUNK_BYTES, position);
			position -= length;
			const chunk = Buffer.allocUnsafe(length);
			const { bytesRead } = await file.read(chunk, 0, length, position);
			const data = Buffer.concat([chunk.subarray(0, bytesRead), partial]);
			let lineEnd = data.length;
			for (let index = data.length - 1; index >= 0; index -= 1) {
				if (data[index] !== 0x0a) continue;
				const result = inspect(data.subarray(index + 1, lineEnd));
				if (result !== undefined) return result ?? undefined;
				lineEnd = index;
			}
			partial = data.subarray(0, lineEnd);
		}
		const result = inspect(partial);
		return result ?? undefined;
	} finally {
		await file.close();
	}
}

async function latest(path) {
	if (!path) return undefined;
	const expanded = expandHome(path);
	let metadata;
	try {
		metadata = await stat(expanded);
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}
	const cached = assistantCache.get(expanded);
	if (cached?.size === metadata.size && cached.mtimeMs === metadata.mtimeMs)
		return cached.result;
	const result = await latestAssistant(expanded, metadata.size);
	assistantCache.set(expanded, {
		size: metadata.size,
		mtimeMs: metadata.mtimeMs,
		result,
	});
	return result;
}

async function directory(value, fallback) {
	const base = expandHome(fallback?.trim() || homedir());
	const path = resolve(base, expandHome(value?.trim() || "."));
	const metadata = await stat(path).catch((error) => {
		throw new Error(
			`cannot use working directory ${JSON.stringify(path)}: ${error.message}`,
		);
	});
	if (!metadata.isDirectory())
		throw new Error(`${JSON.stringify(path)} is not a directory`);
	return path;
}

function serializableError(error) {
	return {
		message: error instanceof Error ? error.message : String(error),
		...(typeof error?.code === "string" ? { code: error.code } : {}),
		...(error?.herdrResponse === true ? { herdrResponse: true } : {}),
	};
}

async function handle(message) {
	if (
		!message ||
		typeof message !== "object" ||
		typeof message.id !== "string" ||
		typeof message.op !== "string"
	) {
		throw new Error("invalid Shepherdr bridge request");
	}
	if (message.op === "request") {
		return request(message.method, message.params ?? {}, message.timeoutMs);
	}
	if (message.op === "subscribe") {
		await subscribe(message.id, message.subscriptions ?? []);
		return { subscribed: true };
	}
	if (message.op === "unsubscribe") {
		subscriptions.get(message.subscription)?.();
		subscriptions.delete(message.subscription);
		return { unsubscribed: true };
	}
	if (message.op === "latest") return latest(message.path);
	if (message.op === "directory")
		return directory(message.value, message.fallback);
	throw new Error(`unsupported Shepherdr bridge operation ${message.op}`);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	input += chunk;
	if (Buffer.byteLength(input) > MAX_FRAME_BYTES) {
		process.stderr.write("Shepherdr bridge request is too large\n");
		process.exit(1);
	}
	for (;;) {
		const newline = input.indexOf("\n");
		if (newline < 0) break;
		const line = input.slice(0, newline);
		input = input.slice(newline + 1);
		if (!line) continue;
		let message;
		try {
			message = JSON.parse(line);
		} catch (error) {
			send({ id: "invalid", ok: false, error: serializableError(error) });
			continue;
		}
		void handle(message).then(
			(result) => send({ id: message.id, ok: true, result }),
			(error) =>
				send({ id: message.id, ok: false, error: serializableError(error) }),
		);
	}
});

process.stdin.on("end", () => process.exit());
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		for (const close of subscriptions.values()) close();
		process.exit();
	});
}

send({
	type: "ready",
	version: BRIDGE_VERSION,
	socket: socketPath(),
});
