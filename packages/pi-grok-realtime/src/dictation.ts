import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { WebSocket } from "ws";
import { ActiveVoiceGuard } from "./active-owner.ts";
import type { RealtimeAudio } from "./audio.ts";
import type { GrokRealtimeConfig } from "./config.ts";
import { resolveBearer } from "./credentials.ts";
import { DictationPcm, dictationLanguage } from "./dictation-input.ts";

interface Run {
	abort: AbortController;
	audio: RealtimeAudio;
	socket?: WebSocket;
	ready: Promise<void>;
	resolveReady(): void;
	rejectReady(error: Error): void;
	done: Promise<string>;
	resolveDone(text: string): void;
	rejectDone(error: Error): void;
	finalized: string[];
	closed: boolean;
	cleanup?: Promise<void>;
	readyTimer?: ReturnType<typeof setTimeout>;
}

export class GrokDictationController {
	private readonly ownership: ActiveVoiceGuard;
	onChange: (() => void) | undefined;
	private current: Run | undefined;
	private displayed: Run | undefined;
	private result: { run: Run; text: string } | undefined;
	private view: { status: string; text: string; error?: string } = {
		status: "idle",
		text: "",
	};

	constructor(pi: ExtensionAPI) {
		this.ownership = new ActiveVoiceGuard(pi, "Grok", () =>
			Boolean(this.current),
		);
	}

	state(): { status: string; text: string; error?: string } {
		return { ...this.view };
	}

	private update(status: string, text = this.view.text, error?: string): void {
		this.view = { status, text, ...(error ? { error } : {}) };
		this.onChange?.();
	}

	async start(
		ctx: ExtensionContext,
		config: GrokRealtimeConfig,
		audio: RealtimeAudio,
	): Promise<void> {
		if (this.current) throw new Error("Dictation is already active");
		return this.ownership.start(async () => {
			const ready = Promise.withResolvers<void>();
			const done = Promise.withResolvers<string>();
			// Completion can fail before the caller requests finish.
			void ready.promise.catch(() => {});
			void done.promise.catch(() => {});
			const run: Run = {
				abort: new AbortController(),
				audio,
				ready: ready.promise,
				resolveReady: ready.resolve,
				rejectReady: ready.reject,
				done: done.promise,
				resolveDone: done.resolve,
				rejectDone: done.reject,
				finalized: [],
				closed: false,
			};
			this.current = run;
			this.displayed = run;
			this.result = undefined;
			this.update("connecting", "");
			try {
				const bearer = await resolveBearer(
					ctx,
					config.access,
					run.abort.signal,
				);
				if (run.closed) throw new Error("Dictation cancelled");
				const url = new URL("wss://api.x.ai/v1/stt");
				url.searchParams.set("sample_rate", "16000");
				url.searchParams.set("encoding", "pcm");
				url.searchParams.set("interim_results", "true");
				url.searchParams.set("endpointing", "400");
				url.searchParams.set("language", dictationLanguage(config.language));
				const socket = new WebSocket(url, {
					headers: { Authorization: `Bearer ${bearer}` },
					handshakeTimeout: 15_000,
					maxPayload: 0,
				});
				run.socket = socket;
				socket.once("open", () => {
					if (run.closed) return;
					run.readyTimer = setTimeout(
						() =>
							this.fail(
								run,
								new Error("Dictation did not become ready; try again"),
							),
						10_000,
					);
				});
				socket.on("message", (data, binary) => {
					if (run.closed) return;
					if (binary) {
						this.fail(run, new Error("Invalid dictation response"));
						return;
					}
					try {
						this.receive(run, JSON.parse(data.toString()));
					} catch {
						this.fail(run, new Error("Invalid dictation response"));
					}
				});
				socket.on("error", () =>
					this.fail(
						run,
						new Error(
							"Dictation connection failed; try starting dictation again",
						),
					),
				);
				socket.on("close", () => {
					if (!run.closed)
						this.fail(
							run,
							new Error(
								"Dictation disconnected before the final transcript; try again",
							),
						);
				});
				await run.ready;
				if (run.closed) throw new Error("Dictation cancelled");
				const input = new DictationPcm();
				const starting = audio.start({
					onAudio: (pcm) => {
						if (run.closed || this.view.status === "finishing") return;
						if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0) {
							this.fail(
								run,
								new Error("Dictation audio must be mono i16 LE PCM"),
							);
							return;
						}
						try {
							const converted = input.convert(pcm);
							if (converted.length) socket.send(converted);
						} catch {
							this.fail(run, new Error("Could not send dictation audio"));
						}
					},
					onError: (error) => this.fail(run, error),
				});
				await Promise.race([
					starting,
					run.done.then(() => {
						throw new Error("Dictation ended during startup");
					}),
				]);
				if (run.closed) throw new Error("Dictation cancelled");
				this.update("recording");
			} catch (error) {
				const failure =
					error instanceof Error ? error : new Error(String(error));
				if (!run.closed) this.fail(run, failure);
				await this.cleanup(run);
				throw failure;
			}
		});
	}

	private receive(run: Run, event: unknown): void {
		if (!event || typeof event !== "object" || !("type" in event))
			throw new Error("Invalid event");
		if (event.type === "transcript.created") {
			clearTimeout(run.readyTimer);
			run.resolveReady();
		} else if (event.type === "transcript.partial") {
			if (
				!("text" in event) ||
				typeof event.text !== "string" ||
				!("is_final" in event) ||
				typeof event.is_final !== "boolean" ||
				!("speech_final" in event) ||
				typeof event.speech_final !== "boolean"
			)
				throw new Error("Invalid partial");
			if (event.is_final) run.finalized.push(event.text);
			const text = [...run.finalized, ...(event.is_final ? [] : [event.text])]
				.filter(Boolean)
				.join(" ");
			this.update(this.view.status, text);
		} else if (event.type === "transcript.done") {
			if (!("text" in event) || typeof event.text !== "string")
				throw new Error("Invalid transcript");
			const text = event.text.trim() ? event.text : this.view.text;
			this.result = { run, text };
			this.update("done", text);
			run.resolveDone(text);
			void this.cleanup(run).catch((error: unknown) => {
				if (this.displayed !== run) return;
				this.update(
					"error",
					this.view.text,
					error instanceof Error
						? error.message
						: "Could not close dictation audio",
				);
			});
		} else if (event.type === "error") {
			this.fail(
				run,
				new Error(
					"Dictation transcription failed; try starting dictation again",
				),
			);
		}
	}

	private fail(run: Run, error: Error): void {
		if (run.closed) return;
		this.update("error", this.view.text, error.message);
		run.rejectReady(error);
		run.rejectDone(error);
		void this.cleanup(run).catch((failure: unknown) => {
			if (this.displayed !== run) return;
			this.update(
				"error",
				this.view.text,
				failure instanceof Error
					? failure.message
					: "Could not close dictation audio",
			);
		});
	}

	private cleanup(run: Run): Promise<void> {
		if (run.cleanup) return run.cleanup;
		run.closed = true;
		clearTimeout(run.readyTimer);
		run.abort.abort();
		if (run.socket && run.socket.readyState !== WebSocket.CLOSED)
			run.socket.terminate();
		run.cleanup = run.audio.close().finally(() => {
			if (this.current === run) this.current = undefined;
		});
		return run.cleanup;
	}

	async finish(): Promise<string> {
		const run = this.current;
		if (!run) return this.takeResult();
		if (this.view.status === "connecting") {
			await this.cancel();
			return "";
		}
		if (this.view.status !== "finishing") {
			this.update("finishing");
			try {
				await run.audio.close();
				if (!run.closed)
					run.socket?.send(JSON.stringify({ type: "audio.done" }));
			} catch (error) {
				this.fail(
					run,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
		try {
			await run.done;
			return this.takeResult(run);
		} finally {
			await this.cleanup(run);
		}
	}
	private takeResult(run?: Run): string {
		const result = this.result;
		if (!result || (run && result.run !== run)) return "";
		this.result = undefined;
		return result.text;
	}

	cancelStartup(): void {
		const run = this.current;
		if (this.view.status === "connecting")
			void this.cancel().catch((error: unknown) => {
				if (this.displayed !== run) return;
				this.update(
					"error",
					this.view.text,
					error instanceof Error ? error.message : "Could not cancel dictation",
				);
			});
	}

	async cancel(): Promise<void> {
		const run = this.current;
		this.result = undefined;
		this.update("idle", "");
		if (!run) return;
		const error = new Error("Dictation cancelled");
		run.rejectReady(error);
		run.rejectDone(error);
		await this.cleanup(run);
	}
}
