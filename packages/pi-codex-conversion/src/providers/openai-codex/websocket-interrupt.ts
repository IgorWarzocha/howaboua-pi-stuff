import type { WebSocketLike } from "./types.ts";
import { decodeWebSocketData } from "./websocket-parser.ts";

/** Observes only the sent response; cancelled output never rejoins the consumer. */
export function observeWebSocketInterruption(socket: WebSocketLike) {
	let responseId: string | undefined;
	let completed = false;
	let sent = false;
	let accepted = false;
	let disposed = false;
	let settle: (() => void) | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let messages = Promise.resolve();

	const dispose = () => {
		disposed = true;
		if (timer) clearTimeout(timer);
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("error", dispose);
		socket.removeEventListener("close", dispose);
		settle?.();
	};
	const interrupt = () => {
		if (!settle || !responseId || sent || disposed) return;
		if (completed) { dispose(); return; }
		sent = true;
		try {
			socket.send(JSON.stringify({ type: "response.interrupt", response_id: responseId, mode: "discard_partial_items" }));
		} catch { dispose(); }
	};
	const onMessage = (event: unknown) => {
		messages = messages.then(async () => {
			if (disposed || !event || typeof event !== "object" || !("data" in event)) return;
			const text = await decodeWebSocketData(event.data);
			if (!text || disposed) return;
			let value: unknown;
			try { value = JSON.parse(text); } catch { return; }
			if (!value || typeof value !== "object" || !("type" in value)) return;
			const response = "response" in value && value.response && typeof value.response === "object" ? value.response : undefined;
			if (value.type === "response.created" && response && "id" in response && typeof response.id === "string") {
				responseId = response.id;
				interrupt();
			} else if (value.type === "response.interrupt.accepted" || value.type === "response.interrupt.failed") {
				if (!settle) return;
				if (!sent || accepted || !("response_id" in value) || value.response_id !== responseId || value.type === "response.interrupt.failed") {
					dispose();
					return;
				}
				accepted = true;
				if (completed) dispose();
			} else if (["response.completed", "response.done", "response.incomplete", "response.interrupted"].includes(String(value.type))) {
				completed = true;
				if (settle && (!sent || accepted)) dispose();
			} else if (value.type === "error" || value.type === "response.failed") dispose();
		}).catch(dispose);
	};
	socket.addEventListener("message", onMessage);
	socket.addEventListener("error", dispose);
	socket.addEventListener("close", dispose);
	return {
		dispose,
		cancel(): Promise<void> | undefined {
			if (disposed || completed) { dispose(); return undefined; }
			const cleanup = new Promise<void>(resolve => { settle = resolve; });
			// Match Codex's bounded background cancellation, not steering/drain reuse.
			timer = setTimeout(dispose, 1_000);
			timer.unref?.();
			interrupt();
			return cleanup;
		},
	};
}
