import { performance } from "node:perf_hooks";
import { WebSocket } from "ws";
import type { GrokRealtimeConfig } from "./config.ts";
import { VOICE_PROMPT, VOICE_TOOLS } from "./prompt.ts";
import type { GrokToolWireDefinition } from "./tools.ts";

export interface GrokSessionCallbacks {
	audio(pcm: Buffer): void;
	audioDone(responseId?: string): Promise<void>;
	interrupt(): void;
	endCall(): void;
	transcript(role: "user" | "assistant", text: string): void;
	task(callId: string, request: string): void;
	nativeTool?(
		callId: string,
		name: string,
		args: Record<string, unknown>,
	): void;
	executeTool?(
		name: string,
		args: Record<string, unknown>,
		callId: string,
	): Promise<unknown>;
	status(status: string): void;
	error(error: Error): void;
	disconnected?(error: Error): void;
	diagnostic?(event: Record<string, unknown>): void;
}

/** One xAI socket. Function outputs are receipts; Pi outcomes are later context. */
export class GrokSession {
	private socket: WebSocket | undefined;
	private closed = false;
	private ready = false;
	private responsePending = false;
	private speechActive = false;
	private awaitingVadResponse = false;
	private responseRequested = false;
	private responseId: string | undefined;
	private readonly activeResponses = new Set<string>();
	private readonly retired = new Set<string>();
	private readonly calls = new Set<string>();
	private pendingTools = 0;
	private ending = false;
	private muted = false;
	private piBusy = false;
	private webSearch = false;
	private silenceSeconds = 0;
	private configuration: Record<string, unknown> | undefined;
	private pendingContext: string[] = [];
	private earlyAudio: Buffer[] = [];
	private readonly playbackDrains = new Set<symbol>();
	private playback:
		| { item: string; index: number; started: number; bytes: number }
		| undefined;
	private readonly callbacks: GrokSessionCallbacks;
	constructor(callbacks: GrokSessionCallbacks) {
		this.callbacks = callbacks;
	}

	async start(
		connection: {
			url: string;
			protocols: string[];
			headers: Record<string, string>;
		},
		config: GrokRealtimeConfig,
		context: string,
		signal: AbortSignal,
		tools: readonly GrokToolWireDefinition[] = [],
		instructions = VOICE_PROMPT,
		resumed = false,
	): Promise<void> {
		if (signal.aborted || this.closed)
			throw new Error("Voice startup cancelled");
		this.silenceSeconds = config.silenceSeconds;
		this.webSearch = config.webSearch;
		this.configuration = {
			instructions,
			voice: config.voice,
			tools: [
				...VOICE_TOOLS,
				...tools,
				...(config.webSearch ? [{ type: "web_search" }] : []),
			],
			tool_choice: "auto",
			reasoning: { effort: config.reasoning },
			audio: {
				input: {
					format: { type: "audio/pcm", rate: 24000 },
					...(config.language === "auto"
						? {}
						: { transcription: { language_hint: config.language } }),
				},
				output: {
					format: { type: "audio/pcm", rate: 24000 },
					speed: config.speed,
				},
			},
		};
		const socket = new WebSocket(connection.url, connection.protocols, {
			headers: connection.headers,
			maxPayload: 0,
		});
		this.socket = socket;
		const prepared = Promise.withResolvers<void>();
		const abort = () => {
			prepared.reject(new Error("Voice startup cancelled"));
			this.close();
		};
		signal.addEventListener("abort", abort, { once: true });
		socket.on("open", () => {
			try {
				this.updateConfiguration();
			} catch {
				prepared.reject(new Error("Grok voice setup could not be sent"));
				this.fail(new Error("Grok voice setup could not be sent"));
			}
		});
		socket.on("message", (data, binary) => {
			try {
				if (binary) throw new Error("Grok sent unexpected binary audio");
				const value: unknown = JSON.parse(data.toString());
				if (!value || typeof value !== "object" || Array.isArray(value))
					throw new Error("Invalid Grok voice event");
				const event = value as Record<string, unknown>;
				if (event["type"] === "session.updated" && !this.ready) {
					this.ready = true;
					if (context)
						this.context(
							`Prior Pi conversation, for continuity only:\n${context}`,
							false,
						);
					for (const pcm of this.earlyAudio) this.appendAudio(pcm);
					this.earlyAudio = [];
					prepared.resolve();
					this.callbacks.status("listening");
					if (!resumed)
						this.context(
							"The voice call has just connected. Greet the caller briefly and invite them to speak; do not recap prior work.",
						);
				}
				this.receive(event);
			} catch (error) {
				this.fail(
					error instanceof Error
						? error
						: new Error("Invalid Grok voice event"),
				);
				prepared.reject(new Error("Grok voice setup failed"));
			}
		});
		socket.on("error", () => {
			prepared.reject(new Error("Grok voice connection failed"));
			this.fail(
				new Error(
					"Grok voice connection failed; check the selected account access",
				),
				true,
			);
		});
		socket.on("close", (code) => {
			this.callbacks.diagnostic?.({ type: "connection.closed", code });
			prepared.reject(new Error("Grok voice closed during setup"));
			if (!this.closed)
				this.fail(new Error("Grok voice connection closed"), true);
		});
		try {
			await prepared.promise;
		} finally {
			signal.removeEventListener("abort", abort);
		}
	}

	appendAudio(pcm: Buffer): void {
		if (this.closed || this.muted || !pcm.length) return;
		if (pcm.length % 2) throw new Error("Invalid microphone PCM frame");
		if (!this.ready) {
			this.earlyAudio.push(Buffer.from(pcm));
			return;
		}
		this.send({
			type: "input_audio_buffer.append",
			audio: pcm.toString("base64"),
		});
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		if (muted) this.earlyAudio = [];
		if (!this.ready || this.closed) return;
		if (muted) {
			// Clearing an unfinished utterance need not produce speech_stopped.
			this.speechActive = false;
			this.awaitingVadResponse = false;
			this.send({ type: "input_audio_buffer.clear" });
		}
		this.updateConfiguration();
		this.flush();
	}

	setPiBusy(busy: boolean): void {
		if (this.piBusy === busy) return;
		this.piBusy = busy;
		if (!this.ready || this.closed) return;
		this.updateConfiguration();
	}

	private updateConfiguration(): void {
		if (!this.configuration) return;
		this.send({
			type: "session.update",
			session: {
				...this.configuration,
				turn_detection: this.turnDetection(),
			},
		});
	}

	private turnDetection(): {
		type: "server_vad";
		idle_timeout_ms: number | null;
	} {
		return {
			type: "server_vad",
			idle_timeout_ms:
				!this.muted && !this.piBusy && this.silenceSeconds
					? this.silenceSeconds * 1000
					: null,
		};
	}

	context(text: string, speak = true): void {
		if (this.closed || !text.trim()) return;
		this.pendingContext.push(text);
		if (speak) this.responseRequested = true;
		this.flush();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.ready = false;
		this.pendingContext = [];
		this.earlyAudio = [];
		this.playbackDrains.clear();
		const socket = this.socket;
		this.socket = undefined;
		socket?.close();
	}

	private receive(event: Record<string, unknown>): void {
		if (this.closed) return;
		const type = event["type"];
		if (type !== "response.output_audio.delta")
			this.callbacks.diagnostic?.({
				direction: "received",
				type,
				response_id: event["response_id"],
				item_id: event["item_id"],
				call_id: event["call_id"],
				...diagnosticToolFields(event),
				...(event["item"] ? { item: diagnosticToolFields(event["item"]) } : {}),
				...(type === "error" ? { error: event["error"] } : {}),
				...(type === "response.done" ? { response: event["response"] } : {}),
				...(type === "response.created" ? { response: event["response"] } : {}),
				...(type === "session.created" || type === "session.updated"
					? { session: diagnosticSession(event["session"]) }
					: {}),
			});
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
			this.awaitingVadResponse = false;
			this.responsePending = false;
			const response = record(event["response"]);
			this.responseId = textField(response, "id");
			if (this.responseId) this.activeResponses.add(this.responseId);
			this.callbacks.status("responding");
		}
		if (type === "input_audio_buffer.speech_started") {
			if (this.muted) return;
			this.ending = false;
			this.speechActive = true;
			this.callbacks.interrupt();
			for (const id of this.activeResponses) this.retired.add(id);
			// Interrupted responses may never emit response.done. They no longer
			// own continuation; late completion must not affect the new turn.
			this.activeResponses.clear();
			this.playbackDrains.clear();
			this.responsePending = false;
			this.responseId = undefined;
			// server_vad owns response cancellation; only local playback needs clearing.
			const playback = this.playback;
			if (playback)
				this.send({
					type: "conversation.item.truncate",
					item_id: playback.item,
					content_index: playback.index,
					audio_end_ms: Math.max(
						0,
						Math.floor(
							Math.min(
								playback.bytes / 48,
								performance.now() - playback.started,
							),
						),
					),
				});
			this.playback = undefined;
			this.callbacks.status("listening");
		}
		if (type === "input_audio_buffer.speech_stopped") {
			if (this.muted) return;
			this.speechActive = false;
			this.awaitingVadResponse = true;
		}
		if (type === "response.output_audio.delta") {
			const responseId = textField(event, "response_id");
			if (this.speechActive || (responseId && this.retired.has(responseId)))
				return;
			const delta = textField(event, "delta");
			if (!delta || !isBase64(delta))
				throw new Error("Invalid Grok voice audio");
			const pcm = Buffer.from(delta, "base64");
			if (pcm.length % 2) throw new Error("Incomplete Grok PCM sample");
			const item = textField(event, "item_id");
			if (item) {
				if (this.playback?.item !== item)
					this.playback = {
						item,
						index:
							typeof event["content_index"] === "number"
								? event["content_index"]
								: 0,
						started: performance.now(),
						bytes: 0,
					};
				this.playback!.bytes += pcm.length;
			}
			this.callbacks.audio(pcm);
			this.callbacks.status("speaking");
		}
		if (type === "response.output_audio.done") {
			const responseId = textField(event, "response_id");
			this.callbacks.diagnostic?.({
				type: "playback.submitted",
				response_id: responseId,
				item_id: this.playback?.item,
				currentPlaybackItemBytes: this.playback?.bytes ?? 0,
			});
			if (!this.speechActive && !(responseId && this.retired.has(responseId))) {
				const drain = Symbol();
				this.playbackDrains.add(drain);
				void this.callbacks.audioDone(responseId).then(
					() => {
						if (!this.playbackDrains.delete(drain) || this.closed) return;
						this.flush();
					},
					(error: unknown) =>
						this.fail(
							error instanceof Error
								? error
								: new Error("Voice playback failed"),
						),
				);
			}
		}
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
		if (type === "response.function_call_arguments.done") void this.tool(event);
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
						void this.tool({ ...item, response_id: id });
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

	private async tool(event: Record<string, unknown>): Promise<void> {
		const responseId = textField(event, "response_id");
		if (this.speechActive || (responseId && this.retired.has(responseId)))
			return;
		const callId = textField(event, "call_id");
		if (!callId) {
			this.fail(new Error("Grok returned an invalid tool call ID"));
			return;
		}
		if (this.calls.has(callId)) return;
		this.calls.add(callId);
		// xAI reports native searches through function-call events too. These
		// are observations, not requests for a local result or continuation.
		if (this.webSearch && event["name"] === "web_search") {
			try {
				const args = record(JSON.parse(textField(event, "arguments") ?? "{}"));
				this.callbacks.nativeTool?.(callId, "web_search", args);
			} catch (error) {
				this.callbacks.diagnostic?.({
					type: "native_tool.trace_error",
					call_id: callId,
					message: error instanceof Error ? error.message : String(error),
				});
			}
			return;
		}
		this.pendingTools++;
		let output: unknown;
		try {
			const argumentsText = textField(event, "arguments");
			if (!argumentsText) throw new Error("Invalid task arguments");
			const args = record(JSON.parse(argumentsText));
			if (event["name"] === "end_the_call") {
				if (Object.keys(args).length)
					throw new Error("End call takes no arguments");
				this.ending = true;
				output = { hangUp: true };
			} else if (event["name"] === "send_task") {
				const request = textField(args, "request")?.trim();
				if (!request || Object.keys(args).some((key) => key !== "request"))
					throw new Error("Task must contain a nonempty request");
				this.callbacks.task(callId, request);
				output = { accepted: true, task_id: callId };
			} else {
				const name = textField(event, "name");
				if (!name || !this.callbacks.executeTool)
					throw new Error("Unknown voice tool");
				output = await this.callbacks.executeTool(name, args, callId);
			}
		} catch (error) {
			output = {
				error:
					error instanceof Error ? error.message : "Task could not be accepted",
			};
		}
		this.pendingTools--;
		if (this.closed) return;
		this.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: callId,
				output: JSON.stringify(output),
			},
		});
		this.responseRequested = true;
		this.flush();
	}

	private flush(): void {
		if (
			!this.ready ||
			this.closed ||
			this.ending ||
			this.responsePending ||
			this.activeResponses.size ||
			this.pendingTools ||
			this.playbackDrains.size ||
			this.speechActive ||
			this.awaitingVadResponse
		)
			return;
		if (this.pendingContext.length) {
			// Grok Bot seeds landed updates as a tool-call/output pair. Results
			// belong in conversation history, not only in mutable instructions.
			const callId = `pi-update-${crypto.randomUUID()}`;
			this.send({
				type: "conversation.item.create",
				item: {
					type: "function_call",
					name: "work_landed",
					call_id: callId,
					arguments: "{}",
				},
			});
			this.send({
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: callId,
					output: JSON.stringify({
						status: "landed",
						updates: this.pendingContext.splice(0),
						at: new Date().toISOString(),
					}),
				},
			});
		}
		if (this.responseRequested) {
			this.responseRequested = false;
			this.responsePending = true;
			this.callbacks.status("responding");
			this.send({ type: "response.create" });
		} else this.callbacks.status("listening");
	}
	private send(value: unknown): void {
		if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
		this.socket.send(JSON.stringify(value));
		const event = value as Record<string, unknown>;
		if (event["type"] !== "input_audio_buffer.append")
			this.callbacks.diagnostic?.({
				direction: "sent",
				type: event["type"],
				...(event["type"] === "conversation.item.create"
					? { item: event["item"] }
					: {}),
				...(event["type"] === "session.update"
					? { session: event["session"] }
					: {}),
				...(event["type"] === "conversation.item.truncate"
					? { item_id: event["item_id"], audio_end_ms: event["audio_end_ms"] }
					: {}),
			});
	}
	private fail(error: Error, transport = false): void {
		if (this.closed) return;
		const established = this.ready;
		this.close();
		if (transport && established && this.callbacks.disconnected)
			this.callbacks.disconnected(error);
		else this.callbacks.error(error);
	}
}

function diagnosticSession(
	value: unknown,
): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const session = value as Record<string, unknown>;
	// Log effective configuration, never arbitrary provider auth/session fields.
	return Object.fromEntries(
		[
			"voice",
			"instructions",
			"tools",
			"tool_choice",
			"reasoning",
			"audio",
			"turn_detection",
		]
			.filter((key) => key in session)
			.map((key) => [key, session[key]]),
	);
}

function diagnosticToolFields(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const item = value as Record<string, unknown>;
	return Object.fromEntries(
		[
			"id",
			"type",
			"name",
			"arguments",
			"output",
			"status",
			"action",
			"query",
			"queries",
			"results",
			"sources",
			"url",
			"title",
			"error",
			"output_index",
		]
			.filter((key) => key in item)
			.map((key) => [key, item[key]]),
	);
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid Grok voice object");
	return value as Record<string, unknown>;
}
function textField(
	value: Record<string, unknown>,
	key: string,
): string | undefined {
	return typeof value[key] === "string" ? value[key] : undefined;
}

function isBase64(value: string): boolean {
	if (value.length % 4) return false;
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	for (let index = 0; index < value.length - padding; index++) {
		const code = value.charCodeAt(index);
		if (
			!(
				(code >= 65 && code <= 90) ||
				(code >= 97 && code <= 122) ||
				(code >= 48 && code <= 57) ||
				code === 43 ||
				code === 47
			)
		)
			return false;
	}
	return true;
}
