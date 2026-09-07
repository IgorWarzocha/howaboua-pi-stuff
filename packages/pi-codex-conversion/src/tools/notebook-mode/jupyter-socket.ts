import { createConnection, type Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;
const MAX_FRAMES = 1024;
const IO_TIMEOUT_MS = 5_000;

// ZMTP 3.0 NULL, restricted to the local Deno kernel's DEALER and SUB peers.
// https://rfc.zeromq.org/spec/23/ — Jupyter HMAC remains in jupyter-wire.ts.
export class JupyterSocket {
	private socket: Socket | undefined;
	private reader: AsyncIterator<Buffer> | undefined;
	private buffered: Buffer = Buffer.alloc(0);
	private readonly stopped = new AbortController();
	private ready = false;
	private readonly type: "DEALER" | "SUB";
	private readonly port: number;

	constructor(type: "DEALER" | "SUB", port: number) {
		this.type = type;
		this.port = port;
	}

	async connect(signal?: AbortSignal): Promise<void> {
		const deadline = AbortSignal.timeout(30_000);
		const cancelled = AbortSignal.any([this.stopped.signal, deadline, ...(signal ? [signal] : [])]);
		const abort = () => this.close();
		cancelled.addEventListener("abort", abort, { once: true });
		try {
			while (true) {
				cancelled.throwIfAborted();
				const socket = createConnection({ host: "127.0.0.1", port: this.port });
				this.socket = socket;
				// Keep errors observed even between connection, handshake and iteration.
				socket.on("error", () => {});
				try {
					await new Promise<void>((resolve, reject) => {
						const connected = () => { cleanup(); resolve(); };
						const failed = (error: Error) => { cleanup(); reject(error); };
						const closed = () => failed(new Error("Jupyter socket closed while connecting"));
						const cleanup = () => {
							socket.off("connect", connected);
							socket.off("error", failed);
							socket.off("close", closed);
						};
						socket.once("connect", connected);
						socket.once("error", failed);
						socket.once("close", closed);
					});
					break;
				} catch (error) {
					socket.destroy();
					if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED") throw error;
					await sleep(50, undefined, { signal: cancelled });
				}
			}
			this.socket!.setNoDelay(true);
			this.reader = this.socket![Symbol.asyncIterator]();
			const greeting = Buffer.alloc(64);
			greeting[0] = 0xff;
			greeting[9] = 0x7f;
			greeting[10] = 3;
			greeting.write("NULL", 12);
			await this.write(greeting);
			const peer = await this.read(64);
			if (peer[0] !== 0xff || peer[9] !== 0x7f || peer[10]! < 3 ||
				!peer.subarray(12, 32).equals(greeting.subarray(12, 32))) {
				throw new Error("Jupyter requires a ZMTP 3 NULL peer");
			}
			const property = Buffer.alloc(1 + 11 + 4 + this.type.length);
			property[0] = 11;
			property.write("Socket-Type", 1);
			property.writeUInt32BE(this.type.length, 12);
			property.write(this.type, 16);
			await this.write(encodeFrame(Buffer.concat([Buffer.from("\x05READY"), property]), 4));
			const handshake = await this.readFrame();
			if (handshake.flags !== 4 && handshake.flags !== 6) throw new Error("Expected Jupyter ZMTP READY command");
			validateReady(handshake.body, this.type);
			if (this.type === "SUB") await this.write(Buffer.from([0, 1, 1]));
			this.ready = true;
		} catch (error) {
			const failure = cancelled.aborted ? cancelled.reason : error;
			this.close();
			throw failure;
		} finally {
			cancelled.removeEventListener("abort", abort);
		}
	}

	async send(frames: readonly Buffer[]): Promise<void> {
		if (!this.ready || this.type !== "DEALER") throw new Error("Jupyter socket is not ready to send");
		if (!frames.length || frames.length > MAX_FRAMES || frames.reduce((size, frame) => size + frame.length, 0) > MAX_MESSAGE_BYTES) {
			throw new Error("Jupyter message exceeds transport limit");
		}
		// One write keeps multipart messages atomic and avoids delayed-ACK stalls.
		await this.write(Buffer.concat(frames.map((frame, index) => encodeFrame(frame, index < frames.length - 1 ? 1 : 0))));
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<Buffer[]> {
		try {
			while (!this.stopped.signal.aborted) {
				const frames: Buffer[] = [];
				let size = 0;
				while (true) {
					const frame = await this.readFrame(MAX_MESSAGE_BYTES - size);
					if (frame.flags & 4) throw new Error("Unexpected Jupyter ZMTP command");
					frames.push(frame.body);
					size += frame.body.length;
					if (frames.length > MAX_FRAMES) throw new Error("Jupyter multipart frame limit exceeded");
					if (!(frame.flags & 1)) break;
				}
				yield frames;
			}
		} finally {
			this.close();
		}
	}

	close(): void {
		this.ready = false;
		this.stopped.abort();
		this.socket?.destroy();
	}

	private async read(size: number): Promise<Buffer> {
		const result = Buffer.allocUnsafe(size);
		let offset = 0;
		while (offset < size) {
			if (!this.buffered.length) {
				const chunk = await this.reader!.next();
				if (chunk.done) throw new Error("Jupyter socket disconnected");
				this.buffered = chunk.value;
			}
			const count = Math.min(size - offset, this.buffered.length);
			this.buffered.copy(result, offset, 0, count);
			this.buffered = this.buffered.subarray(count);
			offset += count;
		}
		return result;
	}

	private async readFrame(limit = MAX_MESSAGE_BYTES): Promise<{ flags: number; body: Buffer }> {
		const flags = (await this.read(1))[0]!;
		if (flags & 0xf8 || ((flags & 4) && (flags & 1))) throw new Error("Invalid Jupyter ZMTP frame flags");
		const length = flags & 2 ? (await this.read(8)).readBigUInt64BE() : BigInt((await this.read(1))[0]!);
		if (length > BigInt(limit)) throw new Error("Jupyter message exceeds transport limit");
		return { flags, body: await this.read(Number(length)) };
	}

	private async write(data: Buffer): Promise<void> {
		const socket = this.socket;
		if (!socket || socket.destroyed) throw new Error("Jupyter socket disconnected");
		await new Promise<void>((resolve, reject) => {
			const finish = (error?: Error | null) => {
				clearTimeout(timer);
				socket.off("close", closed);
				if (error) { socket.destroy(); reject(error); } else resolve();
			};
			const closed = () => finish(new Error("Jupyter socket disconnected during send"));
			const timer = setTimeout(() => finish(new Error("Jupyter socket send timed out")), IO_TIMEOUT_MS);
			socket.once("close", closed);
			socket.write(data, finish);
		});
	}
}

function encodeFrame(body: Buffer, flags: number): Buffer {
	const header = Buffer.alloc(body.length > 255 ? 9 : 2);
	header[0] = flags | (body.length > 255 ? 2 : 0);
	if (body.length > 255) header.writeBigUInt64BE(BigInt(body.length), 1);
	else header[1] = body.length;
	return Buffer.concat([header, body]);
}

function validateReady(body: Buffer, type: "DEALER" | "SUB"): void {
	if (body.length < 6 || !body.subarray(0, 6).equals(Buffer.from("\x05READY"))) {
		throw new Error("Jupyter ZMTP peer did not send READY");
	}
	let peerType: string | undefined;
	for (let offset = 6; offset < body.length;) {
		const nameLength = body[offset++]!;
		if (!nameLength || offset + nameLength + 4 > body.length) throw new Error("Invalid Jupyter READY metadata");
		const name = body.toString("ascii", offset, offset + nameLength).toLowerCase();
		offset += nameLength;
		const valueLength = body.readUInt32BE(offset);
		offset += 4;
		if (offset + valueLength > body.length) throw new Error("Invalid Jupyter READY metadata");
		if (name === "socket-type") peerType = body.toString("ascii", offset, offset + valueLength);
		offset += valueLength;
	}
	if (peerType !== (type === "DEALER" ? "ROUTER" : "PUB")) throw new Error("Incompatible Jupyter ZMTP socket type");
}
