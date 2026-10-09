import { WebSocket } from "ws";

export class RemoteAudio {
	private callbacks:
		| { onAudio(pcm: Buffer): void; onError(error: Error): void }
		| undefined;
	private peer: WebSocket | undefined;
	private muted = false;
	private drainId = 0;
	private drains = new Map<
		number,
		{
			resolve: () => void;
			reject: (error: Error) => void;
		}
	>();

	async start(callbacks: {
		onAudio(pcm: Buffer): void;
		onError(error: Error): void;
	}): Promise<void> {
		this.callbacks = callbacks;
		this.message({ type: "ready" });
	}

	isStarted(): boolean {
		return this.callbacks !== undefined;
	}

	attach(peer: WebSocket): void {
		this.finishDrains();
		this.peer?.close(1000, "Another browser took control");
		this.peer = peer;
		peer.on("message", (data, binary) => {
			if (this.peer !== peer) return;
			if (!binary) {
				try {
					const value = JSON.parse(data.toString());
					if (value?.type === "playback_error")
						this.callbacks?.onError(
							new Error("Browser playback failed; stop and start a new call"),
						);
					if (value?.type === "drained" && Number.isSafeInteger(value.id))
						this.finishDrains(value.id);
				} catch {
					/* Invalid browser control messages have no effect. */
				}
				return;
			}
			if (this.muted) return;
			try {
				const pcm = Array.isArray(data)
					? Buffer.concat(data)
					: Buffer.isBuffer(data)
						? data
						: Buffer.from(data);
				if (pcm.length > 0 && pcm.length % 2 === 0) {
					try {
						this.callbacks?.onAudio(pcm);
					} catch (error) {
						this.callbacks?.onError(
							error instanceof Error
								? error
								: new Error("Microphone input failed"),
						);
					}
				} else if (pcm.length % 2 !== 0) {
					this.callbacks?.onError(new Error("Invalid microphone PCM"));
				}
			} catch (error) {
				this.callbacks?.onError(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		});
		// Browser transport loss must not tear down the host-owned call.
		peer.on("error", () => {});
		peer.on("close", () => {
			if (this.peer === peer) {
				this.peer = undefined;
				this.finishDrains();
			}
		});
		this.setMuted(this.muted);
		if (this.callbacks) this.message({ type: "ready" });
	}

	play(pcm: Buffer): void {
		if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0)
			throw new Error("Invalid playback PCM");
		if (this.peer?.readyState !== WebSocket.OPEN) return;

		this.peer.send(pcm, { binary: true });
	}

	clear(): void {
		this.finishDrains();
		this.message({ type: "clear" });
	}
	drain(): Promise<void> {
		if (this.peer?.readyState !== WebSocket.OPEN) return Promise.resolve();
		const id = ++this.drainId;
		return new Promise<void>((resolve, reject) => {
			this.drains.set(id, {
				resolve,
				reject,
			});
			this.message({ type: "drain", id });
		});
	}
	private finishDrains(id?: number, error?: Error): void {
		for (const [key, pending] of this.drains) {
			if (id !== undefined && key !== id) continue;
			this.drains.delete(key);
			if (error) pending.reject(error);
			else pending.resolve();
		}
	}
	setMuted(muted: boolean): void {
		this.muted = muted;
		this.message({ type: "mute", muted });
	}
	private message(value: unknown): void {
		if (this.peer?.readyState === WebSocket.OPEN)
			this.peer.send(JSON.stringify(value));
	}
	async close(): Promise<void> {
		this.finishDrains();
		this.callbacks = undefined;
		this.muted = false;
		this.peer?.close(1000, "Voice stopped");
		this.peer = undefined;
	}
}
