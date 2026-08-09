import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import {
	ScriptedWebSocket,
	codeModeTools,
	codexModel,
	fakeJwt,
} from "./openai-codex-test-support.ts";

export type ResponseCreateFrame = {
	type: "response.create";
	input?: unknown[] | undefined;
	previous_response_id?: string | undefined;
	client_metadata?: Record<string, string> | undefined;
};

export const model = {
	...(codexModel as object),
	id: "gpt-5.6-luna",
	baseUrl: "https://chatgpt.example/backend-api",
} as Model<any>;

export const apiKey = fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } });

export function user(text: string, timestamp: number): AgentMessage {
	return { role: "user", content: text, timestamp } as AgentMessage;
}

export function textResponse(responseId: string, text: string) {
	return (socket: ScriptedWebSocket) => {
		const item = {
			id: `msg_${responseId}`,
			type: "message",
			status: "completed",
			content: [{ type: "output_text", annotations: [], logprobs: [], text }],
			phase: "final_answer",
			role: "assistant",
			internal_chat_message_metadata_passthrough: { turn_id: `turn_${responseId}` },
		};
		socket.emitJson({ type: "response.created", response: { id: responseId } });
		socket.emitJson({ type: "response.output_item.done", output_index: 0, item });
		socket.emitJson({
			type: "response.completed",
			response: { id: responseId, status: "completed", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } },
		});
	};
}

export function compactionResponse(responseId: string) {
	return (socket: ScriptedWebSocket) => {
		socket.emitJson({ type: "response.created", response: { id: responseId } });
		socket.emitJson({
			type: "response.output_item.done",
			output_index: 0,
			item: {
				id: `cmp_${responseId}`,
				type: "compaction",
				encrypted_content: "sealed",
				internal_chat_message_metadata_passthrough: { turn_id: `turn_${responseId}` },
			},
		});
		socket.emitJson({
			type: "response.completed",
			response: { id: responseId, status: "completed", usage: { input_tokens: 100, output_tokens: 2, total_tokens: 102 } },
		});
	};
}

export function upgradeRequired(socket: ScriptedWebSocket): void {
	socket.emitError({ error: new Error("Unexpected server response: 426 Upgrade Required") });
}

export function unfinishedResponse(responseId: string, status: "queued" | "in_progress") {
	return (socket: ScriptedWebSocket) => {
		socket.emitJson({ type: "response.created", response: { id: responseId } });
		socket.emitJson({
			type: "response.completed",
			response: { id: responseId, status, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
		});
	};
}

export function streamOptions(sessionId: string) {
	return {
		apiKey,
		transport: "websocket-cached" as const,
		sessionId,
		reasoning: "low" as const,
		textVerbosity: "low",
	};
}

export function context(messages: AgentMessage[], systemPrompt = "Stable instructions", tools = codeModeTools): Context {
	return { systemPrompt, messages: messages as Context["messages"], tools };
}

export function doneMessage(events: unknown[]): AssistantMessage {
	const done = events.find((event) => (event as { type?: string }).type === "done") as { message?: AssistantMessage } | undefined;
	if (!done?.message) throw new Error("provider stream must finish with an assistant message");
	return done.message;
}

export function sentFrames(): ResponseCreateFrame[] {
	return ScriptedWebSocket.sentFrames as ResponseCreateFrame[];
}
