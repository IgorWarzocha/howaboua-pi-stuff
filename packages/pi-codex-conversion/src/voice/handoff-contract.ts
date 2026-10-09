/** Optional Pi event service, shared structurally with Conversion and Shepherdr. */
export const VOICE_HANDOFF_PROTOCOL = "@howaboua/pi/voice-handoff/v1";
export const VOICE_HANDOFF_REQUEST = `${VOICE_HANDOFF_PROTOCOL}/request`;

/** Authenticated, ordered frames; the transport bounds and buffers initial input. */
export interface VoiceHandoffChannel {
	send(message: unknown): void;
	onMessage(listener: (message: unknown) => void): () => void;
	onClose(listener: (error: Error) => void): () => void;
	close(): void;
}

/** The browser keeps its origin and audio connection while its Pi binding moves. */
export interface TransferredVoiceControls {
	readonly inputMuted: boolean;
	setInputMuted(muted: boolean): void;
	stop(): Promise<void>;
	sendText(text: string): Promise<void>;
	rpc(body: Record<string, unknown>): Promise<unknown>;
	onSessionEvent(listener: (event: string, data: unknown) => void): () => void;
}

export interface VoiceHandoffService {
	protocol: typeof VOICE_HANDOFF_PROTOCOL;
	/** Prefer the active provider when more than one extension offers voice. */
	priority: number;
	status(): { active: boolean; busy: boolean };
	/** Resolves when the replacement call is active, not when the call ends. */
	depart(channel: VoiceHandoffChannel): Promise<void>;
	arrive(channel: VoiceHandoffChannel, continuity: string): Promise<void>;
}

export interface VoiceHandoffServiceRequest {
	protocol: typeof VOICE_HANDOFF_PROTOCOL;
	accept(service: VoiceHandoffService): void;
}

export function isVoiceHandoffRequest(
	value: unknown,
): value is VoiceHandoffServiceRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"protocol" in value &&
			value.protocol === VOICE_HANDOFF_PROTOCOL &&
			"accept" in value &&
			typeof value.accept === "function",
	);
}
