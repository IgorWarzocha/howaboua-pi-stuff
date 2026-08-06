import { zstdDecompressSync } from "node:zlib";
import { registerOpenAICodexCustomProvider, closeOpenAICodexWebSocketSessions } from "../src/providers/openai-codex-custom-provider.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import type { CodexDiagnosticsSink } from "../src/providers/openai-codex/types.ts";
import { CODE_MODE_EXEC_GRAMMAR } from "../src/tools/code-mode/exec-contract.ts";

export const exampleTool = {
	name: "example_tool",
	description: "Example tool",
	parameters: {
		type: "object",
		properties: { value: { type: "string" } },
		required: ["value"],
	},
} as never;

export const searchToolsTool = {
	name: "search_tools",
	description: "Find and activate tools",
	parameters: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
	},
} as never;

export const codeModeTools = [
	{
		name: "exec",
		description: "Compose tools",
		parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
		constrainedSampling: { type: "grammar", variants: { openai_lark: CODE_MODE_EXEC_GRAMMAR } },
	},
	{ name: "wait", description: "Wait for code", parameters: { type: "object", properties: { cell_id: { type: "string" } }, required: ["cell_id"] } },
] as never;

export const codexModel = {
	provider: "openai-codex",
	api: "openai-codex-responses",
	id: "gpt-5.4",
	input: ["text"],
	output: ["text"],
	reasoning: true,
	contextWindow: 272000,
	maxOutputTokens: 100000,
	cost: { input: 0, output: 0 },
} as never;

export const toolLoadingMessages = [
	{ role: "user", content: "Find an example tool" },
	{
		role: "assistant",
		content: [{ type: "toolCall", id: "call_search|fc_search", name: "search_tools", arguments: { query: "example" } }],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-5.4",
		stopReason: "toolUse",
		timestamp: 1,
	},
	{
		role: "toolResult",
		toolCallId: "call_search|fc_search",
		toolName: "search_tools",
		content: [{ type: "text", text: "Loaded tools: example_tool" }],
		addedToolNames: ["example_tool"],
		isError: false,
		timestamp: 2,
	},
] as never;

export function fakeJwt(payload: Record<string, unknown>): string {
	return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");
}

export function sseResponse(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

export function requestBodyText(init: RequestInit): string {
	return init.body instanceof Uint8Array ? zstdDecompressSync(init.body).toString("utf8") : String(init.body);
}

export async function collectStream(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const events: unknown[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

type WebSocketScript = (socket: ScriptedWebSocket) => void;

export class ScriptedWebSocket {
	static scripts: Array<WebSocketScript | WebSocketScript[]> = [];
	static sentFrames: unknown[] = [];
	static opened = 0;
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	readonly scripts: WebSocketScript[];
	readyState = 0;
	private sends = 0;
	private scriptsStarted = 0;

	constructor() {
		const scripts = ScriptedWebSocket.scripts.shift();
		if (!scripts) throw new Error("No scripted WebSocket behavior");
		this.scripts = Array.isArray(scripts) ? scripts : [scripts];
		ScriptedWebSocket.opened++;
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open", {});
		});
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
		this.startScriptWhenReady();
	}

	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(data?: unknown): void {
		if (typeof data === "string") {
			try {
				ScriptedWebSocket.sentFrames.push(JSON.parse(data));
			} catch {
				ScriptedWebSocket.sentFrames.push(data);
			}
		} else {
			ScriptedWebSocket.sentFrames.push(data);
		}
		this.sends++;
		this.startScriptWhenReady();
	}

	private startScriptWhenReady(): void {
		if (this.scriptsStarted >= this.sends || !["message", "error", "close"].every((type) => (this.listeners.get(type)?.size ?? 0) > 0)) return;
		const script = this.scripts[this.scriptsStarted];
		if (!script) throw new Error(`No scripted WebSocket behavior for send ${this.scriptsStarted + 1}`);
		this.scriptsStarted++;
		script(this);
	}

	close(): void {
		this.readyState = 3;
	}

	emit(type: string, event: unknown): void {
		if (type === "error") this.readyState = 2;
		if (type === "close") this.readyState = 3;
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	emitError(event: unknown, closeEvent: unknown = { code: 1006, reason: "" }): void {
		this.emit("error", event);
		this.emit("close", closeEvent);
	}

	emitJson(event: unknown): void {
		this.emit("message", { data: JSON.stringify(event) });
	}
}

export const websocketSuccess: WebSocketScript = (socket) => {
	socket.emitJson({ type: "response.created", response: { id: "resp_ws" } });
	socket.emitJson({ type: "response.completed", response: { id: "resp_ws", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } });
};

export function installScriptedWebSocket(scripts: Array<WebSocketScript | WebSocketScript[]>): () => void {
	const original = globalThis.WebSocket;
	ScriptedWebSocket.scripts = [...scripts];
	ScriptedWebSocket.sentFrames = [];
	ScriptedWebSocket.opened = 0;
	globalThis.WebSocket = ScriptedWebSocket as never;
	return () => {
		globalThis.WebSocket = original;
		ScriptedWebSocket.scripts = [];
		ScriptedWebSocket.sentFrames = [];
		closeOpenAICodexWebSocketSessions();
	};
}

export function codexStreamRequest(sessionId: string) {
	return {
		model: { ...(codexModel as object), baseUrl: "https://chatgpt.example/backend-api" } as never,
		context: { systemPrompt: "Instructions", messages: [] } as never,
		options: {
			apiKey: fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } }),
			transport: "auto",
			sessionId,
		} as never,
	};
}

export function createRegisteredCodexProvider(options?: {
	codeMode?: boolean | undefined;
	onPreparedPayload?: ((payload: unknown) => void) | undefined;
	getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
}) {
	const turnState = createCodexTurnState();
	const providers = new Map<string, { streamSimple: (...args: never[]) => AsyncIterable<unknown> }>();
	const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
	const renderers = new Map<string, unknown>();
	const sentMessages: Array<{ message: unknown; options: unknown }> = [];
	const pi = {
		registerProvider(id: string, provider: { streamSimple: (...args: never[]) => AsyncIterable<unknown> }) {
			providers.set(id, provider);
		},
		on(event: string, handler: (...args: never[]) => unknown) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerMessageRenderer(type: string, renderer: unknown) {
			renderers.set(type, renderer);
		},
		sendMessage(message: unknown, messageOptions: unknown) {
			sentMessages.push({ message, options: messageOptions });
		},
	};

	registerOpenAICodexCustomProvider(pi as never, {
		getConfig: () => ({
			openai: DEFAULT_CODEX_CONVERSION_CONFIG.openai,
			beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: options?.codeMode ?? false },
		}),
		turnState,
		...(options?.onPreparedPayload ? { onPreparedPayload: options.onPreparedPayload as never } : {}),
		...(options?.getDiagnostics ? { getDiagnostics: options.getDiagnostics } : {}),
	});
	return { provider: providers.get("openai-codex")!, handlers, renderers, sentMessages, turnState };
}
