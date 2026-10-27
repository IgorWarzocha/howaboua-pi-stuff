import type { GrokRealtimeConfig } from "../config.ts";
import type { GrokSessionCallbacks } from "../session.ts";
import type { GrokToolWireDefinition } from "../tools.ts";
import {
	effectiveSessionConfiguration,
	sessionConfiguration,
} from "./configuration.ts";
import { GrokSessionPlayback } from "./playback.ts";
import { GrokQuietInterval } from "./quiet.ts";
import { GrokSessionSocket } from "./socket.ts";
import { GrokSessionTools } from "./tools.ts";
import { diagnosticEvent, record, textField } from "./wire.ts";

/** One xAI socket. Function outputs are receipts; Pi outcomes are later context. */
export class GrokTurnSequencer {
	private readonly transport: GrokSessionSocket;
	private closed = false;
	private ready = false;
	private responsePending = false;
	private speechActive = false;
	private awaitingVadResponse = false;
	private responseRequested = false;
	private responseId: string | undefined;
	private readonly activeResponses = new Set<string>();
	private readonly retired = new Set<string>();
	private readonly tools: GrokSessionTools;
	private ending = false;
	private muted = false;
	private piBusy = false;
	private silenceSeconds = 0;
	private readonly quiet: GrokQuietInterval;
	private configuration: Record<string, unknown> | undefined;
	private pendingContext: string[] = [];
	private earlyAudio: Buffer[] = [];
	private readonly playback: GrokSessionPlayback;
	private readonly callbacks: GrokSessionCallbacks;
	constructor(callbacks: GrokSessionCallbacks, transport: GrokSessionSocket) {
		this.callbacks = callbacks;
		this.quiet = new GrokQuietInterval(() => {
			this.responseRequested = true;
			this.callbacks.diagnostic?.({ type: "silence.reconsider" });
			this.flush();
		});
		this.transport = transport;
		this.playback = new GrokSessionPlayback(
			callbacks,
			(event) => this.transport.send(event),
			() => this.closed,
			() => this.flush(),
			(error) => this.fail(error),
		);
		this.tools = new GrokSessionTools(
			callbacks,
			(id) => !this.speechActive && !(id && this.retired.has(id)),
			() => this.closed,
			(event) => this.transport.send(event),
			(error) => this.fail(error),
			() => {
				this.ending = true;
			},
			(quiet) => {
				if (quiet) this.quiet.accept();
				else this.responseRequested = true;
				this.flush();
			},
		);
	}

	configure(
		config: GrokRealtimeConfig,
		tools: readonly GrokToolWireDefinition[],
		instructions: string,
	): void {
		this.silenceSeconds = config.silenceSeconds;
		this.tools.webSearch = config.webSearch;
		this.configuration = sessionConfiguration(config, tools, instructions);
	}
	get isClosed(): boolean {
		return this.closed;
	}
	connected(
		event: Record<string, unknown>,
		context: string,
		resumed: boolean,
	): void {
		if (event["type"] === "session.updated" && !this.ready) {
			this.ready = true;
			if (context)
				this.context(
					`Prior Pi conversation, for continuity only:\n${context}`,
					false,
				);
			for (const pcm of this.earlyAudio) this.appendAudio(pcm);
			this.earlyAudio = [];
			this.transport.established();
			this.callbacks.status("listening");
			if (!resumed)
				this.context(
					"The voice call has just connected. Greet the caller briefly and invite them to speak; do not recap prior work.",
				);
		}
		this.receive(event);
	}

	appendAudio(pcm: Buffer): void {
		if (this.closed || this.muted || !pcm.length) return;
		if (pcm.length % 2) throw new Error("Invalid microphone PCM frame");
		if (!this.ready) {
			this.earlyAudio.push(Buffer.from(pcm));
			return;
		}
		this.transport.send({
			type: "input_audio_buffer.append",
			audio: pcm.toString("base64"),
		});
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		if (muted) this.quiet.cancel();
		if (muted) this.earlyAudio = [];
		if (!this.ready || this.closed) return;
		if (muted) {
			// Clearing an unfinished utterance need not produce speech_stopped.
			this.speechActive = false;
			this.awaitingVadResponse = false;
			this.transport.send({ type: "input_audio_buffer.clear" });
		}
		this.updateConfiguration();
		this.flush();
	}

	setPiBusy(busy: boolean): void {
		if (this.piBusy === busy) return;
		this.piBusy = busy;
		if (busy) this.quiet.cancel();
		if (!this.ready || this.closed) return;
		this.updateConfiguration();
		this.flush();
	}

	updateConfiguration(): void {
		if (!this.configuration) return;
		this.transport.send({
			type: "session.update",
			session: effectiveSessionConfiguration(
				this.configuration,
				this.muted,
				this.piBusy,
				this.silenceSeconds,
			),
		});
	}

	context(text: string, speak = true): void {
		if (this.closed || !text.trim()) return;
		this.quiet.clear();
		this.pendingContext.push(text);
		if (speak) this.responseRequested = true;
		this.flush();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.quiet.cancel();
		this.ready = false;
		this.pendingContext = [];
		this.earlyAudio = [];
		this.playback.clearDrains();
		this.transport.close();
	}

	private receive(event: Record<string, unknown>): void {
		if (this.closed) return;
		const type = event["type"];
		if (type !== "response.output_audio.delta")
			this.callbacks.diagnostic?.(diagnosticEvent(event));
		if (type === "error") {
			const error = event["error"];
			const details =
				error && typeof error === "object" && !Array.isArray(error)
					? (error as Record<string, unknown>)
					: {};
			const message = textField(details, "message");
			const code = textField(details, "code");
			this.fail(
				new Error(
					`Grok rejected a voice operation${code ? ` (${code})` : ""}: ${message || "no reason supplied"}. The call has stopped; Pi's reply remains available in this session`,
				),
			);
			return;
		}
		if (type === "response.created") {
			this.quiet.clear();
			this.awaitingVadResponse = false;
			this.responsePending = false;
			const response = record(event["response"]);
			this.responseId = textField(response, "id");
			if (this.responseId) this.activeResponses.add(this.responseId);
			this.callbacks.status("responding");
		}
		if (type === "input_audio_buffer.timeout_triggered") {
			this.quiet.clear();
		}
		if (type === "input_audio_buffer.speech_started") {
			if (this.muted) return;
			this.quiet.clear();
			this.ending = false;
			this.speechActive = true;
			this.callbacks.interrupt();
			for (const id of this.activeResponses) this.retired.add(id);
			// Interrupted responses may never emit response.done. They no longer
			// own continuation; late completion must not affect the new turn.
			this.activeResponses.clear();
			this.playback.clearDrains();
			this.responsePending = false;
			this.responseId = undefined;
			// server_vad owns response cancellation; only local playback needs clearing.
			this.playback.truncate();
			this.callbacks.status("listening");
		}
		if (type === "input_audio_buffer.speech_stopped") {
			if (this.muted) return;
			this.speechActive = false;
			this.awaitingVadResponse = true;
		}
		if (
			type === "response.output_audio.delta" ||
			type === "response.output_audio.done"
		)
			this.playback.receive(event, this.speechActive, (id) =>
				Boolean(id && this.retired.has(id)),
			);
		if (
			type === "conversation.item.input_audio_transcription.completed" ||
			type === "response.output_audio_transcript.done"
		) {
			const transcript = textField(event, "transcript");
			if (transcript)
				this.callbacks.transcript(
					type === "conversation.item.input_audio_transcription.completed"
						? "user"
						: "assistant",
					transcript,
				);
		}
		if (type === "response.function_call_arguments.done")
			void this.tools.receive(event);
		if (type === "response.done") {
			const response = record(event["response"]);
			const id = textField(response, "id");
			if (id && this.retired.has(id)) return;
			// The final output is authoritative even if an arguments event was absent.
			if (
				response["status"] === "completed" &&
				Array.isArray(response["output"])
			)
				for (const value of response["output"]) {
					const item = record(value);
					if (item["type"] === "function_call")
						void this.tools.receive({ ...item, response_id: id });
				}
			if (id) this.activeResponses.delete(id);
			if (this.activeResponses.size) return;
			this.responseId = undefined;
			if (this.ending) {
				this.responseRequested = false;
				this.callbacks.endCall();
				return;
			}
			this.flush();
		}
	}

	private flush(): void {
		if (
			!this.ready ||
			this.closed ||
			this.ending ||
			this.responsePending ||
			this.activeResponses.size ||
			this.tools.pending ||
			this.playback.draining ||
			this.speechActive ||
			this.awaitingVadResponse
		)
			return;
		if (this.pendingContext.length) {
			// Grok Bot seeds landed updates as a tool-call/output pair. Results
			// belong in conversation history, not only in mutable instructions.
			const callId = `pi-update-${crypto.randomUUID()}`;
			this.transport.send({
				type: "conversation.item.create",
				item: {
					type: "function_call",
					name: "work_landed",
					call_id: callId,
					arguments: "{}",
				},
			});
			this.transport.send({
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: callId,
					output: JSON.stringify({
						status: "landed",
						updates: this.pendingContext.splice(0),
					}),
				},
			});
		}
		if (this.responseRequested) {
			this.responseRequested = false;
			this.responsePending = true;
			this.callbacks.status("responding");
			this.transport.send({ type: "response.create" });
		} else {
			this.callbacks.status("listening");
			this.quiet.reconsider(this.muted, this.piBusy, this.silenceSeconds);
		}
	}

	fail(error: Error, transport = false): void {
		if (this.closed) return;
		const established = this.ready;
		this.close();
		if (transport && established && this.callbacks.disconnected)
			this.callbacks.disconnected(error);
		else this.callbacks.error(error);
	}
}
