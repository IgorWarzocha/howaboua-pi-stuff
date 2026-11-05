import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

/** One ordered final-playback marker, owned by the exact audio socket. */
export class LanPlaybackDrain {
	private pending:
		| { socket: WebSocket; id: string; finish(error?: Error): void }
		| undefined;

	wait(
		socket: WebSocket,
		signal: AbortSignal,
		seal: () => Promise<void>,
	): Promise<void> {
		signal.throwIfAborted();
		if (this.pending) throw new Error("Voice playback is already finishing");
		return new Promise((resolve, reject) => {
			const id = randomUUID();
			const finish = (error?: Error) => {
				if (this.pending?.id !== id) return;
				this.pending = undefined;
				clearTimeout(timer);
				socket.off("close", closed);
				signal.removeEventListener("abort", aborted);
				if (error) reject(error);
				else resolve();
			};
			const closed = () =>
				finish(new Error("Voice device disconnected before playback finished"));
			const aborted = () => finish(new Error("Playback wait cancelled"));
			const timer = setTimeout(
				() =>
					finish(
						new Error(
							"Voice device did not confirm playback; reconnect it and try again",
						),
					),
				30_000,
			);
			this.pending = { socket, id, finish };
			socket.once("close", closed);
			signal.addEventListener("abort", aborted, { once: true });
			void Promise.resolve()
				.then(() => {
					if (this.pending?.id === id) return seal();
				})
				.then(() => {
					if (this.pending?.id !== id) return;
					if (socket.readyState !== WebSocket.OPEN) {
						closed();
						return;
					}
					socket.send(JSON.stringify({ type: "drain", id }), (error) => {
						if (error) finish(error);
					});
				})
				.catch((error: unknown) =>
					finish(error instanceof Error ? error : new Error(String(error))),
				);
		});
	}

	acknowledge(socket: WebSocket, id: string): void {
		if (this.pending?.socket === socket && this.pending.id === id)
			this.pending.finish();
	}

	cancel(): void {
		this.pending?.finish(new Error("Voice playback owner changed"));
	}
}
