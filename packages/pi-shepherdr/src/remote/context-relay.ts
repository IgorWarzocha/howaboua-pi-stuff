/** Owns relay handlers and incoming cancellation; transport shutdown aborts the whole relay. */
export class ContextRelay {
	private contextHandler:
		| ((request: unknown, signal: AbortSignal) => Promise<unknown>)
		| undefined;
	private readonly incomingContext = new Map<string, AbortController>();
	private relayPath: string | undefined;
	private readonly send: (message: Record<string, unknown>) => void;
	private readonly closed: () => boolean;
	private readonly maxFrameBytes: number;
	private readonly onFailure: (error: Error) => void;
	constructor(
		send: (message: Record<string, unknown>) => void,
		closed: () => boolean,
		maxFrameBytes: number,
		onFailure: (error: Error) => void,
	) {
		this.send = send;
		this.closed = closed;
		this.maxFrameBytes = maxFrameBytes;
		this.onFailure = onFailure;
	}
	async start(
		threadId: string,
		routeId: string,
		handler: (request: unknown, signal: AbortSignal) => Promise<unknown>,
		call: (message: Record<string, unknown>) => Promise<unknown>,
	): Promise<void> {
		this.contextHandler = handler;
		const path = await call({ op: "context_relay", threadId, routeId });
		if (typeof path !== "string")
			throw new Error("Invalid shared context relay path");
		this.relayPath = path;
	}

	path(): string {
		if (!this.relayPath)
			throw new Error(
				"Shared context relay is unavailable; open /herdr → Status to retry",
			);
		return this.relayPath;
	}

	consume(id: string, value: Record<string, unknown>): boolean {
		if (value["type"] === "context_cancel") {
			this.incomingContext.get(id)?.abort();
			return true;
		}
		if (value["type"] === "context_request") {
			const controller = new AbortController();
			this.incomingContext.set(id, controller);
			const reply = (data: object) => {
				if (this.closed() || controller.signal.aborted) return;
				let frame: Record<string, unknown> = {
					op: "context_reply",
					id,
					...data,
				};
				if (Buffer.byteLength(JSON.stringify(frame)) > this.maxFrameBytes)
					frame = {
						op: "context_reply",
						id,
						ok: false,
						error: "Shared context response is too large",
					};
				this.send(frame);
			};
			void Promise.resolve()
				.then(() => {
					if (!this.contextHandler)
						throw new Error("Shared context controller is unavailable");
					controller.signal.throwIfAborted();
					return this.contextHandler(value["request"], controller.signal);
				})
				.then(
					(result) => reply({ ok: true, result }),
					(error: unknown) =>
						reply({
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						}),
				)
				.finally(() => {
					this.incomingContext.delete(id);
				})
				.catch((error: unknown) =>
					this.onFailure(
						error instanceof Error ? error : new Error(String(error)),
					),
				);
			return true;
		}
		return false;
	}
	abortAll() {
		for (const controller of this.incomingContext.values()) controller.abort();
		this.incomingContext.clear();
	}
}
