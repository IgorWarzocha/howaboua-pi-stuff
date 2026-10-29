import { Socket } from "node:net";
import { object, response } from "./protocol.js";

/** Released Core generation 1 framed attachment. Only attach a private helper. */
export function attachCoreTerminal(
	socketPath: string,
	terminal: string,
	onData: (bytes: Buffer) => void,
	onClose: (error: Error) => void,
): { ready: Promise<void>; write(bytes: Buffer): void; close(): void } {
	const socket = new Socket();
	let buffer = Buffer.alloc(0);
	let framed = false;
	let channel = 0;
	let ended = false;
	let resolveReady: () => void = () => {};
	let rejectReady: (error: Error) => void = () => {};
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const timer = setTimeout(
		() => fail(new Error("Remote focus connection timed out")),
		15_000,
	);
	function close(error = new Error("Remote focus connection closed")) {
		ended = true;
		clearTimeout(timer);
		rejectReady(error);
		socket.destroy();
		buffer = Buffer.alloc(0);
	}
	function fail(error: Error) {
		if (ended) return;
		close(error);
		onClose(error);
	}
	function send(ch: number, kind: number, payload: Buffer) {
		if (ended) throw new Error("Remote focus connection closed");
		if (socket.writableLength + payload.length > 1024 * 1024)
			throw new Error("Remote focus output exceeded its buffer");
		const header = Buffer.alloc(9);
		header.writeUInt32LE(ch, 0);
		header[4] = kind;
		header.writeUInt32LE(payload.length, 5);
		socket.write(Buffer.concat([header, payload]));
	}
	socket.on("error", fail);
	socket.on("close", () =>
		fail(new Error("Remote focus connection disconnected")),
	);
	socket.on("data", (bytes: Buffer) => {
		try {
			buffer = Buffer.concat([buffer, bytes]);
			if (!framed) {
				const newline = buffer.indexOf(10);
				if (newline < 0) {
					if (buffer.length > 64 * 1024)
						throw new Error("Core handshake is too large");
					return;
				}
				const hello = object(
					response(object(JSON.parse(buffer.subarray(0, newline).toString()))),
				);
				if (hello["generation"] !== 1 || hello["framed"] !== true)
					throw new Error("Core does not support generation 1 framed streams");
				buffer = buffer.subarray(newline + 1);
				framed = true;
				send(
					0,
					0,
					Buffer.from(
						JSON.stringify({
							jsonrpc: "2.0",
							id: 1,
							method: "terminal.attach",
							params: { terminal, cols: 80, rows: 24, history: 0 },
						}),
					),
				);
			}
			while (buffer.length >= 9 && !ended) {
				const ch = buffer.readUInt32LE(0);
				const kind = buffer[4];
				const length = buffer.readUInt32LE(5);
				if (length > 1024 * 1024)
					throw new Error("Remote focus frame exceeds 1 MiB");
				if (buffer.length < length + 9) return;
				const payload = buffer.subarray(9, length + 9);
				buffer = buffer.subarray(length + 9);
				if (ch === 0 && kind === 0) {
					const result = object(
						response(object(JSON.parse(payload.toString()))),
					);
					if (
						channel ||
						typeof result["channel"] !== "number" ||
						!Number.isSafeInteger(result["channel"]) ||
						result["channel"] <= 0 ||
						result["channel"] > 0xffffffff
					)
						throw new Error("Core returned an invalid helper stream");
					channel = result["channel"];
					clearTimeout(timer);
					resolveReady();
				} else if (ch === channel && kind === 0) {
					onData(payload);
					if (ended) return;
					const credit = Buffer.alloc(4);
					credit.writeUInt32LE(length);
					send(channel, 1, credit);
				} else if (ch === channel && kind === 2)
					throw new Error("Remote focus process ended");
				else throw new Error("Unexpected Remote focus stream frame");
			}
		} catch (error) {
			fail(error instanceof Error ? error : new Error(String(error)));
		}
	});
	socket.connect(socketPath, () =>
		socket.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hello", params: { generation: 1, framed: true } })}\n`,
		),
	);
	return {
		ready,
		close,
		write(bytes) {
			if (!channel) throw new Error("Remote focus stream is not ready");
			try {
				send(channel, 0, bytes);
			} catch (error) {
				const reason =
					error instanceof Error ? error : new Error(String(error));
				fail(reason);
				throw reason;
			}
		},
	};
}
