// @howaboua/pi-shepherdr managed bridge
import { createHash, randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { basename, dirname } from "node:path";

export const MAX_PEER_FRAME_BYTES = 8 * 1024 * 1024;

export function peerInboxPath(sessionFile, terminalId) {
	const terminal = createHash("sha256")
		.update(terminalId)
		.digest("hex")
		.slice(0, 16);
	return `${sessionFile}.shepherdr-${terminal}.json`;
}

function deliveryError(message, rejected) {
	return Object.assign(new Error(message), {
		code: rejected
			? "SHEPHERDR_DELIVERY_REJECTED"
			: "SHEPHERDR_DELIVERY_UNKNOWN",
	});
}

async function readReceiver(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	// Herdr can report Pi ready before all session_start handlers complete.
	// Wait for receiver publication, never retry a submitted message.
	return new Promise((resolve, reject) => {
		const watcher = watch(dirname(path));
		let settled = false;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			watcher.close();
			if (error) reject(error);
			else resolve(value);
		};
		const timer = setTimeout(
			() =>
				finish(
					Object.assign(new Error("Receiver not published"), {
						code: "ENOENT",
					}),
				),
			5_000,
		);
		const read = () => {
			void readFile(path, "utf8").then(
				(value) => finish(undefined, value),
				(error) => {
					if (error.code !== "ENOENT") finish(error);
				},
			);
		};
		watcher.on("error", (error) => finish(error));
		watcher.on("change", (_event, file) => {
			if (file === null || file === basename(path)) read();
		});
		read();
	});
}

export async function sendPeerMessage(request, expected, text) {
	const { agent } = await request("agent.get", { target: expected.pane_id });
	const sessionFile =
		agent?.agent_session?.kind === "path"
			? agent.agent_session.value
			: undefined;
	if (
		agent?.agent !== "pi" ||
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
	if (agent.agent_status === "blocked") {
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
			error.code === "ENOENT"
				? "Target has no native Shepherdr receiver; update and reload Shepherdr in the target Pi session"
				: `Could not read target Shepherdr receiver: ${error.message}`,
			true,
		);
	}
	if (
		descriptor?.protocol !== 1 ||
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
	const id = randomUUID();
	const frame =
		JSON.stringify({
			protocol: 1,
			id,
			token: descriptor.token,
			sessionFile,
			terminalId: agent.terminal_id,
			text,
		}) + "\n";
	if (Buffer.byteLength(frame) > MAX_PEER_FRAME_BYTES) {
		throw deliveryError("Peer message is too large", true);
	}
	await new Promise((resolve, reject) => {
		let attempted = false;
		let settled = false;
		let buffer = "";
		const socket = createConnection({
			host: "127.0.0.1",
			port: descriptor.port,
		});
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) reject(error);
			else resolve();
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
		const timer = setTimeout(failed, 10_000);
		timer.unref();
		socket.setEncoding("utf8");
		socket.on("error", failed);
		socket.on("end", failed);
		socket.on("close", failed);
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
				if (reply.protocol !== 1 || reply.id !== id) return failed();
				if (reply.ok === true) finish();
				else if (reply.ok === false && typeof reply.error === "string")
					finish(deliveryError(reply.error, reply.rejected === true));
				else failed();
			} catch {
				failed();
			}
		});
	});
}
