import { WebSocket } from "ws";
/** Owns the socket, framing, setup promise and transport diagnostics. */
export class GrokSessionSocket {
	private socket: WebSocket | undefined;
	private closed = false;
	private prepared: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	private readonly diagnostic:
		| ((event: Record<string, unknown>) => void)
		| undefined;
	constructor(
		diagnostic: ((event: Record<string, unknown>) => void) | undefined,
	) {
		this.diagnostic = diagnostic;
	}
	established(): void {
		this.prepared?.resolve();
	}
	close(): void {
		this.closed = true;
		const socket = this.socket;
		this.socket = undefined;
		socket?.close();
	}
	connect(
		connection: {
			url: string;
			protocols: string[];
			headers: Record<string, string>;
		},
		signal: AbortSignal,
		onOpen: () => void,
		onEvent: (event: Record<string, unknown>) => void,
		onFailure: (error: Error, transport?: boolean) => void,
		onAbort: () => void,
	): { ready: Promise<void>; dispose(): void } {
		const socket = new WebSocket(connection.url, connection.protocols, {
			headers: connection.headers,
			maxPayload: 0,
		});
		this.socket = socket;
		const prepared = Promise.withResolvers<void>();
		this.prepared = prepared;
		const abort = () => {
			prepared.reject(new Error("Voice startup cancelled"));
			onAbort();
		};
		signal.addEventListener("abort", abort, { once: true });
		socket.on("open", () => {
			try {
				onOpen();
			} catch {
				prepared.reject(new Error("Grok voice setup could not be sent"));
				onFailure(new Error("Grok voice setup could not be sent"));
			}
		});
		socket.on("message", (data, binary) => {
			try {
				if (binary) throw new Error("Grok sent unexpected binary audio");
				const value: unknown = JSON.parse(data.toString());
				if (!value || typeof value !== "object" || Array.isArray(value))
					throw new Error("Invalid Grok voice event");
				const event = value as Record<string, unknown>;
				onEvent(event);
			} catch (error) {
				onFailure(
					error instanceof Error
						? error
						: new Error("Invalid Grok voice event"),
				);
				prepared.reject(new Error("Grok voice setup failed"));
			}
		});
		socket.on("error", () => {
			prepared.reject(new Error("Grok voice connection failed"));
			onFailure(
				new Error(
					"Grok voice connection failed; check the selected account access",
				),
				true,
			);
		});
		socket.on("close", (code) => {
			this.diagnostic?.({ type: "connection.closed", code });
			prepared.reject(new Error("Grok voice closed during setup"));
			if (!this.closed)
				onFailure(new Error("Grok voice connection closed"), true);
		});
		return {
			ready: prepared.promise,
			dispose: () => signal.removeEventListener("abort", abort),
		};
	}
	send(value: unknown): void {
		if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
		this.socket.send(JSON.stringify(value));
		const event = value as Record<string, unknown>;
		if (event["type"] !== "input_audio_buffer.append")
			this.diagnostic?.({
				direction: "sent",
				type: event["type"],
				...(event["type"] === "conversation.item.create"
					? { item: event["item"] }
					: {}),
				...(event["type"] === "session.update"
					? { session: event["session"] }
					: {}),
				...(event["type"] === "conversation.item.truncate"
					? { item_id: event["item_id"], audio_end_ms: event["audio_end_ms"] }
					: {}),
			});
	}
}
