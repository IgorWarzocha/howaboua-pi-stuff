import { randomUUID } from "node:crypto";

/** Reverse context traffic shares the live Core transport, never exec polls. */
export function helperContext(context, send) {
	const incoming = new Map();
	const outgoing = new Map();
	const relays = new Map();
	let closed = false;
	function requestController(request, signal) {
		signal.throwIfAborted();
		if (closed) throw new Error("Shared context controller disconnected");
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const finish = (error, result) => {
				if (!outgoing.delete(id)) return;
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(result);
			};
			const abort = () => {
				try {
					if (!closed) send({ type: "context_cancel", id });
				} catch (error) {
					finish(error);
					return;
				}
				finish(
					new Error(
						"Shared context request cancelled; a write may have completed. Reread before retrying",
					),
				);
			};
			const timer = setTimeout(abort, 35_000);
			outgoing.set(id, { finish });
			signal.addEventListener("abort", abort, { once: true });
			try {
				send({ type: "context_request", id, request });
			} catch (error) {
				finish(error);
			}
		});
	}
	return {
		async request(id, execute) {
			if (closed) throw new Error("Shared context connection closed");
			const controller = new AbortController();
			incoming.set(id, controller);
			try {
				return await execute(controller.signal);
			} finally {
				incoming.delete(id);
			}
		},
		async start(threadId, routeId) {
			if (closed) throw new Error("Shared context connection closed");
			const path = context.relayContextPath(threadId, routeId);
			let ready = relays.get(path);
			if (!ready) {
				ready = context.listenContext(path, requestController);
				relays.set(path, ready);
			}
			try {
				await ready;
			} catch (error) {
				relays.delete(path);
				throw error;
			}
			return path;
		},
		consume(message) {
			if (message.op === "context_cancel") {
				incoming.get(message.id)?.abort();
				return true;
			}
			if (message.op === "context_reply") {
				outgoing
					.get(message.id)
					?.finish(
						message.ok ? undefined : new Error(message.error),
						message.result,
					);
				return true;
			}
			return false;
		},
		async close() {
			closed = true;
			for (const controller of incoming.values()) controller.abort();
			for (const entry of outgoing.values())
				entry.finish(new Error("Shared context controller disconnected"));
			await Promise.allSettled(
				[...relays.values()].map(async (ready) => (await ready)()),
			);
			relays.clear();
		},
	};
}
