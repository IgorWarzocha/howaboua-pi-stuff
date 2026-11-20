import { closeApiLiveSession } from "./api-live-close.ts";
import type { CodexRealtimePeer } from "./peer.ts";

/** Owns the API Live start and final-usage handshake, not the peer's lifetime. */
export class ApiLiveSessionHandshake {
	private readonly peer: CodexRealtimePeer;
	private started = false;
	private closing = false;
	private finalization: Promise<void> | undefined;
	private finalizationError: unknown;

	constructor(peer: CodexRealtimePeer) {
		this.peer = peer;
	}

	markStarted(): void {
		this.started = true;
	}

	/** True when the service ended an established call without a local close. */
	markClosed(): boolean {
		const wasStarted = this.started;
		this.started = false;
		return !this.closing && wasStarted;
	}

	finalize(): Promise<void> {
		if (this.finalization) return this.finalization;
		if (!this.started) return Promise.resolve();
		this.closing = true;
		this.finalization = (async () => {
			try {
				await closeApiLiveSession(this.peer);
			} catch (error) {
				this.finalizationError = error;
			} finally {
				this.started = false;
				this.closing = false;
			}
		})();
		return this.finalization;
	}

	throwIfFailed(): void {
		if (this.finalizationError) throw this.finalizationError;
	}
}
