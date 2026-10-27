import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import {
	buildRealtimeCallRequest,
	type RealtimeCallSetup,
	setupRealtimeCall,
} from "./call-setup.ts";
import type { CodexRealtimePeer } from "./peer.ts";
const PEER_READY_TIMEOUT_MS = 15_000;

/** Owns HTTP setup cancellation and the peer-ready handshake for this call. */
export class ConversationSetup {
	private setupAbortController: AbortController | undefined;
	private peerReady: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	private callSetup: RealtimeCallSetup = setupRealtimeCall;
	private readonly peer: CodexRealtimePeer;
	private readonly isStarting: () => boolean;
	private readonly onActive: (muted: boolean) => void;
	private readonly onStatus: (status: string) => void;
	constructor(
		peer: CodexRealtimePeer,
		isStarting: () => boolean,
		onActive: (muted: boolean) => void,
		onStatus: (status: string) => void,
	) {
		this.peer = peer;
		this.isStarting = isStarting;
		this.onActive = onActive;
		this.onStatus = onStatus;
	}
	abort(): void {
		this.setupAbortController?.abort();
		this.setupAbortController = undefined;
	}
	ready(): void {
		this.peerReady?.resolve();
	}
	finish(): void {
		this.peerReady?.resolve();
		this.peerReady = undefined;
	}
	async start(
		auth: CodexVoiceAuth,
		config: CodexConversionConfig,
		instructions: string,
		initialItems?: RealtimeInitialMessageItem[],
		inputMuted = false,
	): Promise<void> {
		const sdp = await this.peer.start(config);
		if (!this.isStarting()) return;
		const headers = new Headers(auth.headers);
		headers.set("openai-alpha", "quicksilver=v2");
		headers.set("content-type", "application/json");
		const endpoint = `${auth.baseUrl.replace(/\/+$/, "")}/realtime/calls?intent=quicksilver&architecture=avas`;
		const setupAbortController = new AbortController();
		this.setupAbortController = setupAbortController;
		const requestBody = JSON.stringify(
			buildRealtimeCallRequest(sdp, config, instructions, initialItems),
		);
		let status: number;
		let answer: string;
		try {
			({ status, answer } = await this.callSetup(
				endpoint,
				headers,
				setupAbortController.signal,
				requestBody,
				auth.env,
			));
		} finally {
			if (this.setupAbortController === setupAbortController)
				this.setupAbortController = undefined;
		}
		if (!this.isStarting()) return;
		if (status === 401 && auth.officialCodex && auth.loginFailure)
			throw auth.loginFailure();
		if (status === 403 && auth.officialCodex)
			throw new Error(
				"Voice access was denied (HTTP 403). Check account access and any network or browser challenge.",
			);
		if (status !== 201)
			throw new Error(
				`Codex voice call failed (${status}): ${answer.slice(0, 1_000)}`,
			);
		this.onActive(inputMuted);
		const peerReady = Promise.withResolvers<void>();
		this.peerReady = peerReady;
		this.onStatus("connecting…");
		this.peer.applyAnswer(answer);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				peerReady.promise,
				new Promise<void>((_resolve, reject) => {
					timeout = setTimeout(
						() => reject(new Error("Codex voice peer did not become ready")),
						PEER_READY_TIMEOUT_MS,
					);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			if (this.peerReady === peerReady) this.peerReady = undefined;
		}
	}
}
