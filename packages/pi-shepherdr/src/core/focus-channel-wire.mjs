// End-to-end credit keeps Core's terminal repaint fallback out of this stream.
const LIMIT = 1024 * 1024;
const CHUNK = 8192;
// PeerChannel's 512KiB JSON plus the transport's data envelope.
const MAX_MESSAGE = 512 * 1024 + 128;
/**
 * @param {string} nonce
 * @param {(bytes:Buffer)=>void} write
 * @param {(message:unknown)=>void} receive
 * @param {(error:Error)=>void} fail
 * @param {()=>void} [onLive]
 */
export function focusWire(nonce, write, receive, fail, onLive) {
	const prefix = `!${nonce}!`;
	let buffer = "";
	let ended = false;
	let heard = Date.now();
	let sent = 0;
	let received = 0;
	let acknowledged = 0;
	let queuedBytes = 0;
	/** @type {Buffer[]} */
	let chunks = [];
	let chunkBytes = 0;
	/** @type {Array<{data:string,end:boolean}>} */
	const queue = [];
	/** @param {object} value */
	const emit = (value) => {
		if (!ended)
			write(
				Buffer.from(
					`${prefix}${Buffer.from(JSON.stringify(value)).toString("base64")}!\n`,
				),
			);
	};
	const flush = () => {
		// Four 8KiB chunks, even after base64 twice, fit below Core's 256KiB credit.
		while (!ended && queue.length && sent - acknowledged < 4) {
			const frame = queue.shift();
			if (!frame) break;
			queuedBytes -= frame.data.length;
			emit({ n: ++sent, ...frame });
		}
	};
	/** @param {unknown} error */
	const failed = (error) => {
		if (ended) return;
		const reason = error instanceof Error ? error : new Error(String(error));
		// Error control bypasses a full data queue; never hide remote overflow as EOF.
		try {
			emit({ error: reason.message });
		} catch {}
		close();
		fail(reason);
	};
	const timer = setInterval(() => {
		try {
			if (Date.now() - heard > 10_000)
				throw new Error("Focus stream lease expired");
			emit({ ping: true });
		} catch (error) {
			failed(error);
		}
	}, 1000);
	function close() {
		ended = true;
		clearInterval(timer);
		queue.length = 0;
		chunks = [];
		buffer = "";
	}
	return {
		close,
		/** @param {unknown} message */
		send(message) {
			if (ended) throw new Error("Focus stream is closed");
			try {
				const json = JSON.stringify(message);
				if (json === undefined) throw new Error("Focus stream requires JSON");
				const bytes = Buffer.from(json);
				if (bytes.length > MAX_MESSAGE)
					throw new Error("Focus stream message exceeds 512 KiB");
				if (queuedBytes + Math.ceil(bytes.length / 3) * 4 > LIMIT)
					throw new Error("Focus stream output exceeded its buffer");
				for (let at = 0; at < bytes.length; at += CHUNK) {
					const data = bytes.subarray(at, at + CHUNK).toString("base64");
					queuedBytes += data.length;
					queue.push({ data, end: at + CHUNK >= bytes.length });
				}
				flush();
			} catch (error) {
				failed(error);
				throw error;
			}
		},
		/** @param {Buffer} bytes */
		push(bytes) {
			if (ended) return;
			try {
				buffer += bytes.toString("ascii");
				if (buffer.length > LIMIT)
					throw new Error("Focus stream input exceeded its buffer");
				for (;;) {
					const start = buffer.indexOf(prefix);
					if (start < 0) {
						buffer = buffer.slice(-prefix.length);
						return;
					}
					const end = buffer.indexOf("!", start + prefix.length);
					if (end < 0) {
						buffer = buffer.slice(start);
						return;
					}
					const frame = JSON.parse(
						Buffer.from(
							buffer.slice(start + prefix.length, end),
							"base64",
						).toString(),
					);
					buffer = buffer.slice(end + 1);
					heard = Date.now();
					if (typeof frame.error === "string") throw new Error(frame.error);
					if (frame.ping === true) {
						onLive?.();
						continue;
					}
					if (Number.isSafeInteger(frame.ack)) {
						if (frame.ack !== acknowledged + 1 || frame.ack > sent)
							throw new Error("Focus stream acknowledgement is out of order");
						acknowledged = frame.ack;
						flush();
						continue;
					}
					if (
						frame.n !== received + 1 ||
						typeof frame.data !== "string" ||
						frame.data.length > 11000 ||
						typeof frame.end !== "boolean"
					)
						throw new Error("Focus stream data is out of order or invalid");
					const chunk = Buffer.from(frame.data, "base64");
					chunkBytes += chunk.length;
					if (chunkBytes > MAX_MESSAGE)
						throw new Error("Focus stream message exceeds 512 KiB");
					chunks.push(chunk);
					received++;
					if (frame.end) {
						const message = JSON.parse(Buffer.concat(chunks).toString());
						chunks = [];
						chunkBytes = 0;
						receive(message);
					}
					emit({ ack: received });
				}
			} catch (error) {
				failed(error);
			}
		},
	};
}
