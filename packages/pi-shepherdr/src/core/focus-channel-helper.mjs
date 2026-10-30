import { createConnection } from "node:net";

// This source is supplied only to an isolated, rm:true helper terminal.
const argument = process.argv[1];
const socketPath = process.env["HC_TERMINAL_SOCKET"];
if (!argument || !socketPath)
	throw new Error("Start focus from a private Core terminal");
const bootstrap = JSON.parse(Buffer.from(argument, "base64").toString());
const { focusWire } = /** @type {typeof import('./focus-channel-wire.mjs')} */ (
	await import(bootstrap.wire)
);
const rpcSocket = createConnection(socketPath);
let rpcBuffer = "";
let id = 0;
/** @type {Map<number,{resolve:(value:unknown)=>void,reject:(error:Error)=>void}>} */
const pending = new Map();
/** @type {import('../types.js').PeerChannel | undefined} */
let peer;
let started = false;
let stopped = false;
/** @param {Error} [error] */
function stop(error) {
	if (stopped) return;
	stopped = true;
	if (error) {
		try {
			wire.send({ type: "error", message: error.message });
		} catch {}
	}
	wire.close();
	peer?.close();
	rpcSocket.destroy();
	for (const entry of pending.values())
		entry.reject(error || new Error("Remote focus closed"));
	pending.clear();
	// Bound a stalled PTY flush as well as normal exit; rm:true removes this terminal.
	setTimeout(() => process.exit(error ? 1 : 0), 100).unref();
	process.stdin.destroy();
	process.stdout.end(() => process.exit(error ? 1 : 0));
}
const wire = focusWire(
	bootstrap.nonce,
	(bytes) => {
		if (process.stdout.writableLength + bytes.length > 1024 * 1024)
			throw new Error("Remote focus output exceeded its buffer");
		process.stdout.write(bytes);
	},
	(value) => {
		if (!value || typeof value !== "object" || !("type" in value))
			throw new Error("Invalid remote focus message");
		if (value.type === "close") return stop();
		if (value.type === "start" && !started) {
			started = true;
			void admit(
				/** @type {Parameters<typeof admit>[0]} */ (
					object("input" in value ? value.input : undefined)
				),
			).catch((error) => stop(error));
		} else if (value.type === "data" && peer && "message" in value)
			peer.send(value.message);
		else
			throw new Error("Remote focus message before admission or out of order");
	},
	stop,
);
/** @param {string} method @param {object} [params] */
function rpc(method, params = {}) {
	return new Promise((resolve, reject) => {
		pending.set(++id, { resolve, reject });
		rpcSocket.write(
			`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
		);
	});
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function object(value) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid remote Core response");
	return /** @type {Record<string,unknown>} */ (value);
}
/** @param {string} method @param {object} params */
async function nativeRequest(method, params) {
	const target = object(params)["target"];
	if (
		method !== "agent.get" ||
		typeof target !== "string" ||
		!/^t[0-9a-z]+$/.test(target)
	)
		throw new Error("Use an exact remote terminal identity");
	const record = object(await rpc("terminal.get", { terminal: target }));
	if (record["address"] !== target || record["state"] !== "live")
		throw new Error("Remote target changed or exited");
	const path = object(record["labels"])["pi.session_file"];
	if (typeof path !== "string" || !path)
		throw new Error("Remote target has no saved Pi session");
	return {
		agent: {
			pane_id: target,
			terminal_id: target,
			agent: path ? "pi" : null,
			agent_session: { kind: "path", value: path },
		},
	};
}
/** @param {{coreId:string, session:string, modules:{channel:string}, expected:import('../types.js').PaneInfo, focus:import('../types.js').FocusRequest}} input */
async function admit(input) {
	const hello = object(await rpc("hello"));
	if (
		object(hello["core"])["id"] !== input.coreId ||
		process.env["HC_SESSION"] !== input.session
	)
		throw new Error(
			"Remote Core identity/session changed; refresh machines before retrying",
		);
	const { openPeerChannel } =
		/** @type {typeof import('../remote/shepherdr-channel.mjs')} */ (
			await import(input.modules.channel)
		);
	const channel = await openPeerChannel(
		nativeRequest,
		input.expected,
		input.focus,
	);
	if (stopped) {
		channel.close();
		return;
	}
	peer = channel;
	wire.send({ type: "admitted" });
	channel.onClose(stop);
	channel.onMessage((message) => wire.send({ type: "data", message }));
}
rpcSocket.setEncoding("utf8");
rpcSocket.on("data", (chunk) => {
	try {
		rpcBuffer += chunk;
		if (rpcBuffer.length > 1024 * 1024)
			throw new Error("Remote focus Core response exceeded its buffer");
		for (;;) {
			const newline = rpcBuffer.indexOf("\n");
			if (newline < 0) break;
			const reply = JSON.parse(rpcBuffer.slice(0, newline));
			rpcBuffer = rpcBuffer.slice(newline + 1);
			const entry = pending.get(reply.id);
			if (!entry) throw new Error("Unexpected remote focus Core response");
			pending.delete(reply.id);
			if (reply.error) entry.reject(new Error(reply.error.message));
			else entry.resolve(reply.result);
		}
	} catch (error) {
		stop(error instanceof Error ? error : new Error(String(error)));
	}
});
rpcSocket.on("error", stop);
rpcSocket.on("close", () => stop(new Error("Remote Core disconnected")));
process.stdin.setRawMode(true);
process.stdin.on("data", (bytes) =>
	wire.push(typeof bytes === "string" ? Buffer.from(bytes) : bytes),
);
process.stdin.on("error", stop);
process.stdin.on("end", () => stop(new Error("Remote focus input closed")));
process.stdout.on("error", stop);
process.on("SIGTERM", () => stop(new Error("Remote focus terminated")));
process.on("SIGHUP", () => stop(new Error("Remote focus disconnected")));
// No application bytes before the host attaches: the first screen paint is not data.
