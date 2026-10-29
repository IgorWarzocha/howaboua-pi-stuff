// Bounded machine.exec cannot stream. This leased mailbox retains requests only
// until their authenticated caller disconnects; a lost poll is never replayed.
// A 1,000,000-byte Notes file can expand sixfold in JSON (e.g. NULs).
// Leave room for Notes envelopes; context frames and raw exec stdin/stdout
// must remain below 8 MiB, and base64 Core frames below 16 MiB.
const RELAY_PAYLOAD_BYTES = 6_250_000;
const BATCH_BYTES = 7 * 1024 * 1024;

export async function serveRelay(input) {
	const { listenContext, relayContextPath } = await import(
		input.modules.context
	);
	const path = relayContextPath(input.threadId, input.routeId);
	const pending = new Map();
	let sequence = 0;
	let wake;
	let lastPoll = Date.now();
	let closed = false;
	const close = await listenContext(path, async (request, signal) => {
		signal.throwIfAborted();
		if (request?.relayToken === input.relayToken) {
			if (request.action === "close") {
				setImmediate(shutdown);
				return true;
			}
			if (request.action === "reply") {
				const entry = pending.get(request.id);
				if (entry) {
					pending.delete(request.id);
					if (request.ok) entry.resolve(request.result);
					else entry.reject(new Error(request.error));
				}
				return true;
			}
			if (request.action !== "poll") throw new Error("Invalid relay action");
			lastPoll = Date.now();
			if (![...pending.values()].some((entry) => !entry.sent))
				await new Promise((resolve) => {
					const timer = setTimeout(done, 8_000);
					function done() {
						clearTimeout(timer);
						signal.removeEventListener("abort", done);
						wake = undefined;
						resolve();
					}
					wake = done;
					signal.addEventListener("abort", done, { once: true });
				});
			const requests = [];
			let bytes = 1024; // active IDs and RPC/receipt envelopes
			for (const [id, entry] of pending) {
				if (entry.sent) continue;
				const value = { id, request: entry.request };
				const size = Buffer.byteLength(JSON.stringify(value));
				if (bytes + size > BATCH_BYTES) break;
				requests.push(value);
				bytes += size;
				entry.sent = true;
			}
			return { requests, active: [...pending.keys()] };
		}
		if (closed) throw new Error("Shared context controller disconnected");
		if (
			pending.size >= 8 ||
			Buffer.byteLength(JSON.stringify(request)) > RELAY_PAYLOAD_BYTES
		)
			throw new Error(
				"Shared context relay is busy or request is too large; narrow the request and retry",
			);
		return new Promise((resolve, reject) => {
			const id = String(++sequence);
			const abort = () => {
				pending.delete(id);
				reject(new Error("Shared context caller disconnected"));
				wake?.();
			};
			pending.set(id, {
				request,
				sent: false,
				resolve: (value) => {
					signal.removeEventListener("abort", abort);
					resolve(value);
				},
				reject: (error) => {
					signal.removeEventListener("abort", abort);
					reject(error);
				},
			});
			signal.addEventListener("abort", abort, { once: true });
			wake?.();
		});
	});
	async function shutdown() {
		if (closed) return;
		closed = true;
		clearInterval(lease);
		wake?.();
		for (const entry of pending.values())
			entry.reject(
				new Error(
					"Shared context controller disconnected; reconnect its machine",
				),
			);
		pending.clear();
		await close();
	}
	const lease = setInterval(() => {
		if (Date.now() - lastPoll > 30_000) void shutdown();
	}, 1_000);
	process.once("SIGTERM", () => void shutdown());
}
