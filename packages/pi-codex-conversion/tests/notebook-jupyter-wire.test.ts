import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { JupyterSocket } from "../src/tools/notebook-mode/jupyter-socket.ts";
import {
	decodeJupyterMessage,
	encodeJupyterMessage,
	type JupyterMessage,
} from "../src/tools/notebook-mode/jupyter-wire.ts";

test("Jupyter transport preserves signed multipart frames and rejects invalid peers", async () => {
	const message: JupyterMessage = {
		header: {
			msg_id: "message-1",
			session: "session-1",
			username: "pi-codex-conversion",
			date: "2026-01-01T00:00:00.000Z",
			msg_type: "kernel_info_request",
			version: "5.3",
		},
		parent_header: {},
		metadata: {},
		content: { probe: true },
	};
	const key = "wire-secret";
	const frames = encodeJupyterMessage(message, key);
	const expected = createHmac("sha256", key)
		.update(frames[2]!)
		.update(frames[3]!)
		.update(frames[4]!)
		.update(frames[5]!)
		.digest("hex");
	assert.equal(frames[1]!.toString(), expected);
	assert.deepEqual(decodeJupyterMessage(frames, key), message);

	const tampered = frames.map((frame) => Buffer.from(frame));
	const content = tampered[5]!;
	content[0] = content[0]! ^ 1;
	assert.equal(decodeJupyterMessage(tampered, key), undefined);

	// Independently encoded ZMTP 3.0 fixtures: short, empty and 64-bit-length frames.
	const multipart = Buffer.concat([Buffer.from("0100030000000000000100", "hex"), Buffer.alloc(256, 7), Buffer.from("00047461696c", "hex")]);
	const messageFrames = [Buffer.alloc(0), Buffer.alloc(256, 7), Buffer.from("tail")];
	await withPeer(Buffer.concat([greeting, routerReady, multipart]), async (socket, receive) => {
		await socket.connect();
		await socket.send(messageFrames);
		assert.deepEqual(await receive(94 + multipart.length), Buffer.concat([greeting, dealerReady, multipart]));
		const iterator = socket[Symbol.asyncIterator]();
		assert.deepEqual((await iterator.next()).value, messageFrames);
		await iterator.return(undefined);
	});
	await withPeer(Buffer.concat([greeting, pubReady, multipart]), async (socket, receive) => {
		await socket.connect();
		assert.deepEqual((await receive(94)).subarray(-3), Buffer.from([0, 1, 1]));
		const iterator = socket[Symbol.asyncIterator]();
		assert.deepEqual((await iterator.next()).value, messageFrames);
		await iterator.return(undefined);
	}, "SUB");
	for (const invalid of [
		Buffer.from("02ffffffffffffffff", "hex"), // Oversized 64-bit length, before allocating body.
		Buffer.from([8, 0]), // Reserved flags.
		Buffer.from([5, 0]), // Command cannot be multipart.
		Buffer.alloc(2050).map((_, index) => index % 2 === 0 ? 1 : 0), // Unbounded empty multipart.
	]) {
		await withPeer(Buffer.concat([greeting, routerReady, invalid]), async (socket) => {
			await socket.connect();
			await assert.rejects(() => socket[Symbol.asyncIterator]().next(), /limit|flags/);
		});
	}
	await withPeer(Buffer.concat([greeting, Buffer.from([4, 7, 5]), Buffer.from("READY"), Buffer.from([0])]), async (socket) => {
		await assert.rejects(() => socket.connect(), /metadata/);
	});
	await withPeer(Buffer.alloc(0), async (socket) => {
		const abort = new AbortController();
		const reason = new Error("cancel handshake");
		const pending = socket.connect(abort.signal);
		const timer = setTimeout(() => abort.abort(reason), 50);
		try { await assert.rejects(pending, (error) => error === reason); }
		finally { clearTimeout(timer); }
	});
});

const greeting = Buffer.from(`ff00000000000000007f03004e554c4c${"00".repeat(48)}`, "hex");
const dealerReady = Buffer.from("041c0552454144590b536f636b65742d54797065000000064445414c4552", "hex");
const routerReady = Buffer.from("041c0552454144590b536f636b65742d5479706500000006524f55544552", "hex");
const pubReady = Buffer.from("04190552454144590b536f636b65742d5479706500000003505542", "hex");

async function withPeer(
	traffic: Buffer,
	check: (socket: JupyterSocket, receive: (size: number) => Promise<Buffer>) => Promise<void>,
	type: "DEALER" | "SUB" = "DEALER",
): Promise<void> {
	const peers: Socket[] = [];
	let received = Buffer.alloc(0);
	let wake: (() => void) | undefined;
	const server = createServer((peer) => {
		peers.push(peer);
		peer.on("error", () => {});
		peer.on("data", (chunk: Buffer) => { received = Buffer.concat([received, chunk]); wake?.(); });
		peer.setNoDelay(true);
		void (async () => {
			// Split greeting/header/body boundaries; the remainder coalesces multiple frames.
			let offset = 0;
			for (const end of [1, 10, 11, 32, 64, 65, 93, 100, traffic.length]) {
				if (end > traffic.length || end <= offset || peer.destroyed) continue;
				peer.write(traffic.subarray(offset, end));
				offset = end;
				await nextTurn();
			}
		})();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert(address && typeof address !== "string");
	const socket = new JupyterSocket(type, address.port);
	try {
		await check(socket, async (size) => {
			while (received.length < size) await new Promise<void>((resolve) => { wake = resolve; });
			return received.subarray(0, size);
		});
	} finally {
		socket.close();
		for (const peer of peers) peer.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}
