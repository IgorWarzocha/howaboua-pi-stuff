import { createConnection } from "node:net";

// The helper talks to its own Core, never to a guessed socket or another host.
export function localCore(socketPath) {
	const connections = new Set();
	let closed = false;
	function open(method, params, receive, fail) {
		if (closed) throw new Error("Core connection closed");
		const socket = createConnection(socketPath);
		connections.add(socket);
		let buffer = "";
		let ended = false;
		const finish = () => {
			if (ended) return;
			ended = true;
			clearTimeout(timer);
			connections.delete(socket);
			socket.destroy();
		};
		const failed = (error = new Error("Core connection closed")) => {
			if (ended) return;
			finish();
			fail(error);
		};
		const timer = setTimeout(
			() => failed(new Error("Core connection timed out")),
			45_000,
		);
		socket.setEncoding("utf8");
		socket.on("connect", () =>
			socket.write(
				JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n",
			),
		);
		socket.on("error", failed);
		socket.on("close", () => failed());
		socket.on("data", (chunk) => {
			try {
				timer.refresh();
				buffer += chunk;
				for (;;) {
					const end = buffer.indexOf("\n");
					if (
						Buffer.byteLength(end < 0 ? buffer : buffer.slice(0, end)) >
						32 * 1024 * 1024
					)
						throw new Error("Core response exceeded its size limit");
					if (end < 0 || ended) break;
					const value = JSON.parse(buffer.slice(0, end));
					buffer = buffer.slice(end + 1);
					if (value.jsonrpc !== "2.0") throw new Error("Invalid Core response");
					if (value.error)
						throw Object.assign(
							new Error(value.error.message),
							value.error.data,
						);
					receive(value, finish);
				}
			} catch (error) {
				failed(error);
			}
		});
		return finish;
	}
	return {
		request(method, params = {}) {
			return new Promise((resolve, reject) =>
				open(
					method,
					params,
					(value, finish) => {
						if (value.id !== 1 || !("result" in value))
							throw new Error("Invalid Core response");
						finish();
						resolve(value.result);
					},
					reject,
				),
			);
		},
		subscribe(filter, receive, fail) {
			let initial = true;
			let stop;
			let floor = 0;
			const ready = new Promise((resolve, reject) => {
				stop = open(
					"events.subscribe",
					filter,
					(value) => {
						if (initial) {
							if (value.id !== 1 || !Array.isArray(value.result?.terminals))
								throw new Error("Invalid Core snapshot");
							initial = false;
							floor = value.result.seq;
							receive({ method: "snapshot", ...value.result });
							resolve();
						} else if (value.method === "event") {
							if (value.params.seq > floor)
								receive({ method: "event", event: value.params });
						} else if (value.method === "missed") {
							floor = value.params.seq;
							receive({ method: "missed", ...value.params });
						} else if (value.method === "heartbeat")
							receive({ method: "heartbeat", seq: value.params.seq });
						else throw new Error("Invalid Core event");
					},
					(error) => {
						reject(error);
						fail(error);
					},
				);
			});
			return { ready, close: () => stop?.() };
		},
		close() {
			closed = true;
			for (const socket of connections) socket.destroy();
			connections.clear();
		},
	};
}
