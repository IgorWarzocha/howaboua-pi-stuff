// @howaboua/pi-shepherdr managed bridge
import { readFile, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { openPeerChannel } from "./shepherdr-channel.mjs";
import {
	listenContext,
	relayContextPath,
	requestContext,
} from "./shepherdr-context.mjs";
import { sendPeerFocus, sendPeerMessage } from "./shepherdr-peer.mjs";
import { readSessionView } from "./shepherdr-session.mjs";
import { watchSessions } from "./shepherdr-session-watch.mjs";

const BRIDGE_VERSION = 16;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const subscriptions = new Map();
const contextRelays = new Map();
const contextRequests = new Map();
const contextCalls = new Map();
const channels = new Map();

function requestController(request, signal) {
	signal.throwIfAborted();
	const id = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		const finish = (error, result) => {
			if (!contextRequests.delete(id)) return;
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (error) reject(error);
			else resolve(result);
		};
		const abort = () => {
			send({ type: "context_cancel", id });
			finish(
				new Error(
					"Shared context request cancelled; a write may have completed. Reread before retrying",
				),
			);
		};
		const timer = setTimeout(() => {
			send({ type: "context_cancel", id });
			finish(
				new Error(
					"Shared context controller did not reply; a write may have completed. Reread before retrying",
				),
			);
		}, 35_000);
		timer.unref();
		contextRequests.set(id, {
			resolve: (result) => finish(undefined, result),
			reject: (error) => finish(error),
		});
		signal.addEventListener("abort", abort, { once: true });
		send({ type: "context_request", id, request });
	});
}

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
	const root = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	const session = argument("session");
	if (
		!session ||
		!/^[a-zA-Z0-9_.-]{1,64}$/.test(session) ||
		session === "." ||
		session === ".."
	) {
		throw new Error("A valid Herdr --session is required");
	}
	return session !== "default"
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
		let ended = false;
		let socket;
		const timer = setTimeout(
			() => disconnected(new Error("Herdr events.subscribe timed out")),
			10_000,
		);
		timer.unref();
		const disconnected = (error) => {
			if (ended) return;
			ended = true;
			clearTimeout(timer);
			subscriptions.delete(id);
			socket.destroy();
			if (!acknowledged)
				reject(
					error ??
						new Error("Herdr events.subscribe closed before acknowledgement"),
				);
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
				if (ended) return;
				if (value.id === requestId && value.error !== undefined) {
					disconnected(errorFromResponse(value.error));
					return;
				}
				if (!acknowledged && value.id === requestId) {
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
		subscriptions.set(id, () => {
			closed = true;
			disconnected(new Error("Herdr subscription cancelled"));
		});
	});
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

async function keybindings() {
	const directory =
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	try {
		const value = JSON.parse(
			await readFile(join(directory, "keybindings.json"), "utf8"),
		);
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
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
	if (message.op === "message") {
		return sendPeerMessage(request, message.agent, message.message);
	}
	if (message.op === "identity") {
		return { host: hostname(), session: argument("session") || "default" };
	}
	if (message.op === "focus") {
		return sendPeerFocus(request, message.agent, message.request);
	}
	if (message.op === "channel_open") {
		const channel = await openPeerChannel(
			request,
			message.agent,
			message.request,
		);
		channels.set(message.id, channel);
		channel.onClose((error) => {
			channels.delete(message.id);
			send({
				type: "channel",
				channel: message.id,
				closed: true,
				error: error.message,
			});
		});
		channel.onMessage((frame) => {
			if (process.stdout.writableLength > 1024 * 1024)
				throw new Error("Focus channel bridge output exceeded its buffer");
			send({ type: "channel", channel: message.id, message: frame });
		});
		return { admitted: true };
	}
	if (message.op === "context") {
		const controller = new AbortController();
		contextCalls.set(message.id, controller);
		try {
			return await requestContext(
				message.path,
				message.request,
				controller.signal,
			);
		} finally {
			contextCalls.delete(message.id);
		}
	}
	if (message.op === "context_relay") {
		const path = relayContextPath(message.threadId, message.routeId);
		if (!contextRelays.has(path))
			contextRelays.set(path, await listenContext(path, requestController));
		return path;
	}
	if (message.op === "subscribe") {
		await subscribe(message.id, message.subscriptions ?? []);
		return { subscribed: true };
	}
	if (message.op === "session_subscribe") {
		const close = watchSessions(
			message.paths ?? [],
			(path) =>
				send({
					subscription: message.id,
					event: { event: "session.changed", data: { path } },
				}),
			(error) => {
				process.stderr.write(
					`Session monitoring disconnected: ${error.message}\n`,
				);
				process.exitCode = 1;
				setTimeout(() => process.exit(), 0);
			},
		);
		subscriptions.set(message.id, close);
		return { subscribed: true };
	}
	if (message.op === "unsubscribe") {
		subscriptions.get(message.subscription)?.();
		subscriptions.delete(message.subscription);
		return { unsubscribed: true };
	}
	if (message.op === "view") return readSessionView(message.path);
	if (message.op === "keybindings") return keybindings();
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
		if (message?.op === "context_cancel") {
			contextCalls.get(message.id)?.abort();
			continue;
		}
		if (message?.op === "channel_send" || message?.op === "channel_close") {
			const channel = channels.get(message.id);
			try {
				if (message.op === "channel_close") channel?.close();
				else if (channel) channel.send(message.message);
				else
					send({
						type: "channel",
						channel: message.id,
						closed: true,
						error: "Focus channel is unavailable",
					});
			} catch (error) {
				channel?.close();
			}
			continue;
		}
		if (message?.op === "context_reply") {
			const pending = contextRequests.get(message.id);
			if (pending) {
				if (message.ok === true) pending.resolve(message.result);
				else
					pending.reject(
						new Error(
							typeof message.error === "string"
								? message.error
								: "Shared context controller failed",
						),
					);
			}
			continue;
		}
		void handle(message).then(
			(result) => send({ id: message.id, ok: true, result }),
			(error) =>
				send({ id: message.id, ok: false, error: serializableError(error) }),
		);
	}
});

async function shutdown() {
	for (const channel of channels.values()) channel.close();
	for (const close of subscriptions.values()) close();
	for (const controller of contextCalls.values()) controller.abort();
	await Promise.allSettled([...contextRelays.values()].map((close) => close()));
	process.exit();
}
process.stdin.on("end", () => {
	void shutdown();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		void shutdown();
	});
}

send({
	type: "ready",
	version: BRIDGE_VERSION,
	socket: socketPath(),
});
