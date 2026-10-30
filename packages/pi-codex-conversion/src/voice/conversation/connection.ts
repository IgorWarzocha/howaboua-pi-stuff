import { FormData } from "undici";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import {
	buildRealtimeCallRequest,
	type RealtimeCallSetup,
	setupRealtimeCall,
} from "./call-setup.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import {
	PUBLIC_REALTIME_INSTRUCTIONS,
	SEND_TASK_TOOL,
} from "./public-turns.ts";

import { END_CALL_TOOL } from "./end-call.ts";

const PEER_READY_TIMEOUT_MS = 15_000;

/** Owns HTTP setup cancellation and the peer-ready handshake for this call. */
export class ConversationSetup {
	private setupAbortController: AbortController | undefined;
	private peerReady: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	private callSetup: RealtimeCallSetup = setupRealtimeCall;
	private readonly peer: CodexRealtimePeer;
	private readonly isStarting: () => boolean;
	private readonly isActive: () => boolean;
	private readonly onActive: (muted: boolean) => void;
	private readonly onStatus: (status: string) => void;
	constructor(
		peer: CodexRealtimePeer,
		isStarting: () => boolean,
		isActive: () => boolean,
		onActive: (muted: boolean) => void,
		onStatus: (status: string) => void,
	) {
		this.peer = peer;
		this.isStarting = isStarting;
		this.isActive = isActive;
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
		const publicRealtime = config.voice.model !== "codex-live-1.1";
		if (!publicRealtime) {
			headers.set("openai-alpha", "quicksilver=v2");
			headers.set("content-type", "application/json");
		} else {
			headers.delete("content-type");
			headers.delete("openai-alpha");
		}
		const endpoint = `${auth.baseUrl.replace(/\/+$/, "")}/realtime/calls${publicRealtime ? "" : "?intent=quicksilver&architecture=avas"}`;
		const setupAbortController = new AbortController();
		this.setupAbortController = setupAbortController;
		let requestBody: string | FormData;
		if (publicRealtime) {
			const form = new FormData();
			form.set("sdp", sdp);
			form.set(
				"session",
				JSON.stringify({
					type: "realtime",
					model:
						config.voice.model === "realtime-2.1-mini"
							? "gpt-realtime-2.1-mini"
							: "gpt-realtime-2.1",
					instructions,
					audio: {
						input: {
							transcription: { model: "gpt-4o-mini-transcribe" },
							turn_detection: {
								type: "server_vad",
								create_response: true,
								interrupt_response: true,
							},
						},
						output: { voice: config.voice.realtimeVoice },
					},
					tools: [SEND_TASK_TOOL, END_CALL_TOOL, ...(auth.realtime?.tools.definitions ?? [])],
					tool_choice: "auto",
				}),
			);
			requestBody = form;
		} else
			requestBody = JSON.stringify(
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
		if (status !== 201 && publicRealtime)
			throw new Error(
				`Realtime call failed (HTTP ${status}). Check the OpenAI API key, model access and billing, then start voice again.`,
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
			if (
				publicRealtime &&
				this.isActive() &&
				!setupAbortController.signal.aborted
			) {
				for (const item of initialItems ?? [])
					this.peer.sendData({
						type: "conversation.item.create",
						item: {
							type: "message",
							role: item.role === "developer" ? "system" : item.role,
							content: item.content.map((part) => ({
								type: item.role === "assistant" ? "text" : "input_text",
								text: part.text,
							})),
						},
					});
				this.peer.sendData({
					type: "conversation.item.create",
					item: {
						type: "message",
						role: "system",
						content: [
							{ type: "input_text", text: PUBLIC_REALTIME_INSTRUCTIONS },
						],
					},
				});
			}
		} finally {
			if (timeout) clearTimeout(timeout);
			if (this.peerReady === peerReady) this.peerReady = undefined;
		}
	}
}
