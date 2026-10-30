import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";
import type { PublicRealtimeAccess } from "../realtime-auth.ts";
import { RealtimeVoiceTurnTracker } from "../turns.ts";
import {
	RealtimeDelegationHandoff,
	type RealtimeHandoffChannel,
	type RealtimeHandoffTarget,
} from "./handoff.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import { RealtimePlayback } from "./playback.ts";
import type { CodexConversationCallbacks } from "./session.ts";

export const SEND_TASK_TOOL = {
	type: "function",
	name: "send_task",
	description: "Delegate work; new instructions steer active work",
	parameters: {
		type: "object",
		properties: {
			request: {
				type: "string",
				description:
					"Self-contained task with relevant voice-discussion decisions and constraints; preserve uncertainty",
			},
		},
		required: ["request"],
		additionalProperties: false,
	},
};
export const PUBLIC_REALTIME_INSTRUCTIONS =
	"This call has tools. Use send_task to delegate work without narrating the routing. Other listed tools run directly. Tool availability here supersedes earlier statements that voice has no tools. While work is underway, send only new instructions, not the same task again. Wait for findings rather than guessing. Updates are background context; speak useful progress and results without treating them as new user requests.";

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function text(
	value: unknown,
	max = MAX_REALTIME_VOICE_INPUT_BYTES,
): string | undefined {
	return typeof value === "string" &&
		value.trim() &&
		Buffer.byteLength(value) <= max
		? value
		: undefined;
}

/** Public Realtime wire, independent from Codex delegation/transcript semantics. */
export class PublicRealtimeTurns {
	readonly handoff: RealtimeDelegationHandoff;
	readonly playback: RealtimePlayback;
	speakableResponsePending = false;
	private readonly tracker = new RealtimeVoiceTurnTracker();
	private readonly abort = new AbortController();
	private access: PublicRealtimeAccess | undefined;
	private readonly calls = new Set<string>();
	private readonly retired = new Set<string>();
	private activeResponse: string | undefined;
	private awaitingResponse = false;
	private speech = false;
	private pendingTools = 0;
	private ending: false | "pending" | "notified" = false;
	private completingResponse = false;
	private continuation = false;
	private quietUntil = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly callbacks: CodexConversationCallbacks;
	private readonly peer: CodexRealtimePeer;
	private readonly isActive: () => boolean;
	private readonly onFailure: (error: Error) => void;
	constructor(
		callbacks: CodexConversationCallbacks,
		peer: CodexRealtimePeer,
		isActive: () => boolean,
		onFailure: (error: Error) => void,
	) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.isActive = isActive;
		this.onFailure = onFailure;
		this.playback = new RealtimePlayback((suppressed) =>
			peer.setSpeakerSuppressed(suppressed),
		);
		this.handoff = new RealtimeDelegationHandoff({
			isActive,
			onContext: (target, channel, content) =>
				this.sendContext(target, channel, content),
			onSettled: (id) => this.tracker.delegationSettled(id),
			onStreamedContextReady: () => {
				if (!this.isActive() || this.abort.signal.aborted || this.ending)
					return;
				this.continuation = true;
				this.schedule();
			},
		});
	}
	cancelEndCall(): void {
		this.ending = false;
	}
	configure(access: PublicRealtimeAccess): void {
		this.access = access;
	}
	get hasPendingInput(): boolean {
		return this.speech;
	}
	audioActivity(): void {
		this.playback.audioActivity();
		this.quietUntil = Date.now() + 500;
		this.schedule();
	}
	receive(value: unknown): void {
		const event = record(value);
		if (!event || this.abort.signal.aborted) return;
		const type = event["type"];
		if (type === "error") {
			const error = record(event["error"]);
			if (error?.["code"] === "conversation_already_has_active_response") {
				// VAD may start a response between our idle check and response.create.
				// Keep the pending receipt for after that response, without retrying now.
				this.continuation = true;
				this.awaitingResponse =
					!this.activeResponse || this.retired.has(this.activeResponse);
				this.callbacks.onStatus("responding");
				return;
			}
			this.onFailure(
				new Error(
					text(error?.["message"], 1000) ??
						"Realtime call failed. Stop and start voice to retry.",
				),
			);
		} else if (type === "input_audio_buffer.speech_started") {
			this.speech = true;
			this.tracker.inputStarted();
			// Server VAD owns the next response. Do not race its automatic creation.
			this.awaitingResponse = true;
			this.continuation = false;
			if (this.activeResponse) this.retired.add(this.activeResponse);
			this.playback.inputStarted(this.speakableResponsePending);
		} else if (type === "input_audio_buffer.speech_stopped") {
			this.speech = false;
			this.playback.inputFinished(this.speakableResponsePending, true);
			this.schedule();
		} else if (
			type === "conversation.item.input_audio_transcription.completed"
		) {
			const transcript = text(event["transcript"]);
			if (transcript) {
				if (this.tracker.userFinished(transcript))
					this.callbacks.onUserTranscript(transcript);
			}
		} else if (type === "response.created") {
			const response = record(event["response"]);
			this.activeResponse = text(response?.["id"], 256);
			this.awaitingResponse = false;
			this.speakableResponsePending = true;
		} else if (
			type === "response.output_audio_transcript.delta" ||
			type === "response.output_audio.delta"
		) {
			const id = text(event["response_id"], 256);
			if (id && this.retired.has(id)) return;
			this.playback.outputAdded();
			this.callbacks.onStatus("speaking");
		} else if (type === "response.output_audio_transcript.done") {
			const id = text(event["response_id"], 256);
			if (id && this.retired.has(id)) return;
			const transcript = text(event["transcript"]);
			if (transcript) {
				this.playback.outputAdded();
				const turn = this.tracker.assistantFinished(transcript);
				if (turn) this.callbacks.onTurn(turn);
			}
		} else if (type === "response.done") {
			const response = record(event["response"]);
			const id = text(response?.["id"], 256);
			if (!id) return;
			const interrupted = this.retired.delete(id);
			if (!interrupted && response?.["status"] === "failed") {
				const details = record(response["status_details"]);
				const error = record(details?.["error"]);
				this.onFailure(
					new Error(
						text(error?.["message"], 1000) ??
							"Realtime could not produce a response. Check model access and billing, then start voice again.",
					),
				);
				return;
			}
			if (this.activeResponse === id) {
				this.activeResponse = undefined;
				this.speakableResponsePending = false;
				this.playback.outputFinished();
				this.callbacks.onStatus("listening");
			}
			if (
				!interrupted &&
				response?.["status"] === "completed" &&
				Array.isArray(response["output"])
			) {
				this.completingResponse = true;
				for (const item of response["output"]) {
					const call = record(item);
					if (call?.["type"] === "function_call") void this.execute(call);
				}
				this.completingResponse = false;
			}
			this.schedule();
		}
	}
	sendContext(
		_target: RealtimeHandoffTarget,
		channel: RealtimeHandoffChannel,
		content: string,
	): void {
		if (!this.isActive() || this.abort.signal.aborted || this.ending) return;
		this.send({
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "system",
				content: [{ type: "input_text", text: content }],
			},
		});
		if (channel === "speakable") {
			this.continuation = true;
			this.schedule();
		}
	}
	private async execute(call: Record<string, unknown>): Promise<void> {
		const id = text(call["call_id"], 256);
		if (!id || this.calls.has(id)) return;
		this.calls.add(id);
		this.pendingTools++;
		let output: unknown;
		try {
			const name = text(call["name"], 64);
			const raw = text(call["arguments"], 32 * 1024);
			if (!name || !raw)
				throw new Error("Voice tool arguments were missing or oversized");
			const args = record(JSON.parse(raw));
			if (!args) throw new Error("Voice tool arguments must be an object");
			if (name === "end_call") {
				if (Object.keys(args).length)
					throw new Error("end_call takes no arguments");
				this.ending ||= "pending";
				output = {
					ending: true,
					message:
						"Say your brief farewell now; the call will close after playback. Other work continues independently.",
				};
			} else if (name === "send_task") {
				const request = text(args["request"]);
				if (!request || Object.keys(args).some((key) => key !== "request"))
					throw new Error("send_task requires only a nonempty request");
				const delegated = this.tracker.delegated(request, id);
				if (delegated) {
					if (delegated.displayInput) this.callbacks.onUserTranscript(request);
					this.callbacks.onTurn(delegated.turn);
				}
				output = { accepted: Boolean(delegated), task_id: id };
			} else {
				if (!this.access)
					throw new Error("Voice tool is unavailable; restart the call");
				output = await this.access.tools.execute(name, args, {
					ctx: this.access.ctx,
					signal: this.abort.signal,
					callId: id,
				});
			}
			const serialized = JSON.stringify(output);
			if (Buffer.byteLength(serialized) > 32 * 1024)
				throw new Error(
					"Voice tool result exceeded 32 KiB; request a narrower result",
				);
		} catch (error) {
			output = {
				error:
					error instanceof Error
						? Buffer.from(error.message).subarray(0, 4096).toString("utf8")
						: "Voice tool failed",
			};
		} finally {
			this.pendingTools--;
		}
		if (this.abort.signal.aborted || !this.isActive()) return;
		this.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: id,
				output: JSON.stringify(output),
			},
		});
		this.continuation = true;
		this.schedule();
	}
	private send(event: unknown): void {
		try {
			this.peer.sendData(event);
		} catch (error) {
			this.onFailure(error instanceof Error ? error : new Error(String(error)));
		}
	}
	private schedule(): void {
		clearTimeout(this.timer);
		// Farewells wait for tool receipts; send_task settles at acceptance, not Pi completion.
		if (
			!this.continuation ||
			!this.isActive() ||
			this.abort.signal.aborted ||
			this.pendingTools ||
			this.completingResponse ||
			this.activeResponse ||
			this.awaitingResponse ||
			this.speech
		)
			return;
		const delay = this.quietUntil - Date.now();
		if (delay > 0) {
			this.timer = setTimeout(() => this.schedule(), delay);
			return;
		}
		this.continuation = false;
		this.awaitingResponse = true;
		this.speakableResponsePending = true;
		if (this.ending === "pending") {
			this.ending = "notified";
			// Start the playback deadline only once direct tools have settled.
			this.callbacks.onEndCall?.();
		}
		this.send({ type: "response.create" });
	}
	drainConversation(): void {
		this.abort.abort();
		clearTimeout(this.timer);
		const tail = this.tracker.takeTranscriptTail();
		if (tail) this.callbacks.onTranscriptTail(tail);
		this.tracker.reset();
	}
}
