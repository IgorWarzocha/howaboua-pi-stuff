import type { CodexConversionConfig } from "../../adapter/activation/config.ts";

export type CodexRealtimePeerEvent =
	| { type: "state"; state: string }
	| { type: "data"; message: unknown }
	| { type: "error"; message: string };

export interface CodexRealtimePeer {
	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void;
	onExit(listener: (error: Error) => void): () => void;
	start(config: CodexConversionConfig): Promise<string>;
	applyAnswer(sdp: string): void;
	sendData(message: unknown): void;
	close(): Promise<void>;
}
