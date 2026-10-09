import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REQUEST = "@howaboua/pi/active-voice/v1";
type Request = { owner: string; refuse(owner: string): void };

/** Event-bus arbitration is synchronous: reserve before the first startup await.
 * Each controller reports its own lifecycle; idle LAN servers never participate.
 */
export class ActiveVoiceGuard {
	private pending = 0;
	private readonly pi: ExtensionAPI;
	private readonly owner: string;
	constructor(pi: ExtensionAPI, owner: string, active: () => boolean) {
		this.pi = pi;
		this.owner = owner;
		pi.events.on(REQUEST, (value: unknown) => {
			if (!value || typeof value !== "object") return;
			const request = value as Partial<Request>;
			if (
				typeof request.owner !== "string" ||
				typeof request.refuse !== "function"
			)
				return;
			if (request.owner !== owner && (this.pending > 0 || active()))
				request.refuse(owner);
		});
	}
	async start<T>(action: () => Promise<T>): Promise<T> {
		this.assertAvailable();
		return this.hold(action);
	}
	assertAvailable(): void {
		let conflict: string | undefined;
		this.pi.events.emit(REQUEST, {
			owner: this.owner,
			refuse: (owner: string) => {
				conflict ??= owner;
			},
		} satisfies Request);
		if (conflict)
			throw new Error(
				`${conflict} voice or dictation is active or stopping; stop it before starting ${this.owner}`,
			);
	}
	async hold<T>(action: () => Promise<T>): Promise<T> {
		this.pending++;
		try {
			return await action();
		} finally {
			this.pending--;
		}
	}
}
