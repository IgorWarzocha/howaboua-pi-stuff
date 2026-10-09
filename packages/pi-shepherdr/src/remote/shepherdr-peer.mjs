// @howaboua/pi-shepherdr managed bridge
import { createHash, randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { basename, dirname } from "node:path";

export const MAX_PEER_FRAME_BYTES = 8 * 1024 * 1024;
export const PEER_PROTOCOL = 3;

/** @param {string} sessionFile @param {string} terminalId */
export function peerInboxPath(sessionFile, terminalId) {
	const terminal = createHash("sha256")
		.update(terminalId)
		.digest("hex")
		.slice(0, 16);
	return `${sessionFile}.shepherdr-${terminal}.json`;
}

/** @param {string} message @param {boolean} rejected */
function deliveryError(message, rejected) {
	return Object.assign(new Error(message), {
		code: rejected
			? "SHEPHERDR_DELIVERY_REJECTED"
			: "SHEPHERDR_DELIVERY_UNKNOWN",
	});
}

/** @param {unknown} error */
function isMissing(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} path @returns {Promise<string>} */
export async function readReceiver(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	// Herdr can report Pi ready before all session_start handlers complete.
	// Wait for receiver publication, never retry a submitted message.
	return new Promise((resolve, reject) => {
		const watcher = watch(dirname(path));
		let settled = false;
		const finish = () => {
			if (settled) return false;
			settled = true;
			clearTimeout(timer);
			watcher.close();
			return true;
		};
		/** @param {unknown} error */
		const fail = (error) => {
			if (finish()) reject(error);
		};
		const timer = setTimeout(
			() =>
				fail(
					Object.assign(new Error("Receiver not published"), {
						code: "ENOENT",
					}),
				),
			5_000,
		);
		const read = () => {
			void readFile(path, "utf8").then(
				(value) => {
					if (finish()) resolve(value);
				},
				(error) => {
					if (!isMissing(error)) fail(error);
				},
			);
		};
		watcher.on("error", fail);
		watcher.on("change", (_event, file) => {
			if (file === null || file === basename(path)) read();
		});
		read();
	});
}

/**
 * @param {(method: string, params: object) => Promise<unknown>} request
 * @param {import("../types.js").PaneInfo} expected
 * @param {import("../types.js").PeerMessage} message
 * @param {import("../types.js").FocusRequest} [focus]
 * @returns {Promise<import("../types.js").PeerDelivery>}
 */
export async function sendPeerMessage(request, expected, message, focus) {
	const { descriptor, sessionFile, agent } = await resolvePeerReceiver(
		request,
		expected,
		Boolean(focus),
	);
	const id = randomUUID();
	const frame =
		JSON.stringify({
			protocol: PEER_PROTOCOL,
			kind: focus ? "focus" : "message",
			focus,
			id,
			token: descriptor.token,
			sessionFile,
			terminalId: agent.terminal_id,
			text: message.text,
			sender: message.sender,
			context: message.context,
		}) + "\n";
	return deliverPeerFrame(
		request,
		expected,
		message,
		focus,
		descriptor,
		sessionFile,
		id,
		frame,
	);
}

/**
 * @param {(method: string, params: object) => Promise<unknown>} request
 * @param {import("../types.js").PaneInfo} expected
 * @param {boolean} allowBlocked
 */
export async function resolvePeerReceiver(request, expected, allowBlocked) {
	const result = await request("agent.get", { target: expected.pane_id });
	const agent =
		result &&
		typeof result === "object" &&
		"agent" in result &&
		result.agent &&
		typeof result.agent === "object"
			? result.agent
			: {};
	const session = "agent_session" in agent ? agent.agent_session : undefined;
	const sessionFile =
		session &&
		typeof session === "object" &&
		"kind" in session &&
		session.kind === "path" &&
		"value" in session &&
		typeof session.value === "string"
			? session.value
			: undefined;
	if (
		!("agent" in agent) ||
		agent.agent !== "pi" ||
		!("terminal_id" in agent) ||
		typeof agent.terminal_id !== "string" ||
		agent.terminal_id !== expected.terminal_id ||
		!sessionFile ||
		(expected.agent_session?.kind === "path" &&
			expected.agent_session.value !== sessionFile)
	) {
		throw deliveryError(
			"Target Pi session changed or is not ready; resolve the target again",
			true,
		);
	}
	if (
		!allowBlocked &&
		"agent_status" in agent &&
		agent.agent_status === "blocked"
	) {
		throw deliveryError(
			"Target is blocked; answer its pending question first",
			true,
		);
	}
	let descriptor;
	try {
		descriptor = JSON.parse(
			await readReceiver(peerInboxPath(sessionFile, agent.terminal_id)),
		);
	} catch (error) {
		throw deliveryError(
			isMissing(error)
				? "Target has no native Shepherdr receiver; update and reload Shepherdr in the target Pi session"
				: `Could not read target Shepherdr receiver: ${error instanceof Error ? error.message : String(error)}`,
			true,
		);
	}
	if (
		descriptor?.protocol !== PEER_PROTOCOL ||
		!Number.isInteger(descriptor.port) ||
		descriptor.port < 1 ||
		descriptor.port > 65535 ||
		typeof descriptor.token !== "string" ||
		!/^[a-f0-9]{64}$/.test(descriptor.token)
	) {
		throw deliveryError(
			"Target Shepherdr receiver is invalid; reload the target Pi session",
			true,
		);
	}
	return { descriptor, sessionFile, agent };
}

/**
 * @param {(method: string, params: object) => Promise<unknown>} request
 * @param {import("../types.js").PaneInfo} expected
 * @param {import("../types.js").PeerMessage} message
 * @param {import("../types.js").FocusRequest | undefined} focus
 * @param {{port:number,token:string}} descriptor
 * @param {string} sessionFile
 * @param {string} id
 * @param {string} frame
 * @returns {Promise<import("../types.js").PeerDelivery>}
 */
function deliverPeerFrame(
	request,
	expected,
	message,
	focus,
	descriptor,
	sessionFile,
	id,
	frame,
) {
	if (Buffer.byteLength(frame) > MAX_PEER_FRAME_BYTES) {
		throw deliveryError("Peer message is too large", true);
	}
	return new Promise((resolve, reject) => {
		let attempted = false;
		let settled = false;
		let buffer = "";
		let closing = false;
		const socket = createConnection({
			host: "127.0.0.1",
			port: descriptor.port,
		});
		/** @param {unknown} [error] @param {import("../types.js").PeerDelivery} [receipt] */
		const finish = (error, receipt) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) reject(error);
			else if (receipt) resolve(receipt);
		};
		const failed = () =>
			finish(
				deliveryError(
					attempted
						? "Peer delivery was not acknowledged; inspect the target before retrying"
						: "Target Shepherdr receiver is unavailable; reload the target Pi session",
					!attempted,
				),
			);
		const timer = setTimeout(failed, focus ? 55_000 : 10_000);
		timer.unref();
		socket.setEncoding("utf8");
		socket.on("error", failed);
		socket.on("end", () => {
			if (settled) return;
			if (!closing) return failed();
			clearTimeout(timer);
			void closeExitedPane(request, expected, sessionFile).then(
				() => finish(undefined, { command: true }),
				(error) =>
					finish(
						deliveryError(
							`Pi shut down, but its pane could not be closed: ${error instanceof Error ? error.message : String(error)}`,
							false,
						),
					),
			);
		});
		socket.on("close", () => {
			if (!closing) failed();
		});
		socket.on("connect", () => {
			attempted = true;
			socket.write(frame);
		});
		socket.on("data", (chunk) => {
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_PEER_FRAME_BYTES) return failed();
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			try {
				const reply = JSON.parse(buffer.slice(0, newline));
				if (reply.protocol !== PEER_PROTOCOL || reply.id !== id)
					return failed();
				if (reply.ok === true && typeof reply.command === "boolean") {
					if (
						reply.closing === true &&
						reply.command &&
						message.text.trim() === "/quit"
					) {
						closing = true;
						// The receiver retains this socket through session_shutdown.
						// Only process exit ends it; never close a pane on a timeout.
						clearTimeout(timer);
					} else finish(undefined, { command: reply.command });
				} else if (reply.ok === false && typeof reply.error === "string")
					finish(deliveryError(reply.error, reply.rejected === true));
				else failed();
			} catch {
				failed();
			}
		});
	});
}

/**
 * @param {(method: string, params: object) => Promise<unknown>} request
 * @param {import("../types.js").PaneInfo} expected
 * @param {import("../types.js").FocusRequest} focus
 */
export function sendPeerFocus(request, expected, focus) {
	return sendPeerMessage(
		request,
		expected,
		{ text: "focus", sender: "" },
		focus,
	);
}

/**
 * @param {(method: string, params: object) => Promise<unknown>} request
 * @param {import("../types.js").PaneInfo} expected
 * @param {string} sessionFile
 */
async function closeExitedPane(request, expected, sessionFile) {
	const result = await request("pane.current", {
		caller_pane_id: expected.pane_id,
	});
	const pane =
		result && typeof result === "object" && "pane" in result
			? result.pane
			: undefined;
	if (
		!pane ||
		typeof pane !== "object" ||
		!("pane_id" in pane) ||
		typeof pane.pane_id !== "string" ||
		!("terminal_id" in pane) ||
		pane.terminal_id !== expected.terminal_id
	)
		throw new Error("Target pane changed; resolve it again");
	if (
		"agent_session" in pane &&
		pane.agent_session &&
		typeof pane.agent_session === "object" &&
		"value" in pane.agent_session &&
		pane.agent_session.value !== sessionFile
	)
		throw new Error("Target session changed; resolve it again");
	await request("pane.close", { pane_id: pane.pane_id });
}
