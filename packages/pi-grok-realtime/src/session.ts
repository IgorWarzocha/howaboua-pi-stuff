import type { GrokRealtimeConfig } from "./config.ts";
import { VOICE_PROMPT } from "./prompt.ts";
import { GrokSessionSocket } from "./session/socket.ts";
import { GrokTurnSequencer } from "./session/turns.ts";
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

/** One connection activation; the sequencer owns all live turn state. */
export class GrokSession {
	private readonly transport: GrokSessionSocket;
	private readonly turns: GrokTurnSequencer;
	constructor(callbacks: GrokSessionCallbacks) {
		this.transport = new GrokSessionSocket(callbacks.diagnostic);
		this.turns = new GrokTurnSequencer(callbacks, this.transport);
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
		if (signal.aborted || this.turns.isClosed)
			throw new Error("Voice startup cancelled");
		this.turns.configure(config, tools, instructions);
		const setup = this.transport.connect(
			connection,
			signal,
			() => this.turns.updateConfiguration(),
			(event) => this.turns.connected(event, context, resumed),
			(error, transport) => this.turns.fail(error, transport),
			() => this.close(),
		);
		try {
			await setup.ready;
		} finally {
			setup.dispose();
		}
	}
	appendAudio(pcm: Buffer): void {
		this.turns.appendAudio(pcm);
	}
	setMuted(muted: boolean): void {
		this.turns.setMuted(muted);
	}
	setPiBusy(busy: boolean): void {
		this.turns.setPiBusy(busy);
	}
	context(text: string, speak = true): void {
		this.turns.context(text, speak);
	}
	close(): void {
		this.turns.close();
	}
}
