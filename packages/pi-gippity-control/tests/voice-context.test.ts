import { expect, test } from "bun:test";
import { DEFAULT_GIPPITY_CONTROL_CONFIG } from "../src/config.ts";
import { buildRealtimeInitialItems } from "../src/voice/context.ts";
import { buildRealtimeCallRequest } from "../src/voice/conversation/session.ts";

test("voice startup projects mixed-provider history into V3 context", async () => {
	let sidecarContext: unknown;
	let sidecarModel: unknown;
	const userEntry = {
		type: "message",
		id: "user-message",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		message: {
			role: "user",
			content: [
				{ type: "text", text: "Inspect this screenshot" },
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			],
			timestamp: 1,
		},
	};
	const workingEntry = {
		type: "message",
		id: "working-message",
		parentId: userEntry.id,
		timestamp: new Date(2).toISOString(),
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "private reasoning" },
				{ type: "text", text: "Checking files" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: {} },
			],
			stopReason: "toolUse",
			timestamp: 2,
		},
	};
	const toolEntry = {
		type: "message",
		id: "tool-message",
		parentId: workingEntry.id,
		timestamp: new Date(3).toISOString(),
		message: {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "large code dump" }],
			isError: false,
			timestamp: 3,
		},
	};
	const answerEntry = {
		type: "message",
		id: "answer-message",
		parentId: toolEntry.id,
		timestamp: new Date(4).toISOString(),
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "final private reasoning" },
				{ type: "text", text: "This is the final answer." },
			],
			stopReason: "stop",
			timestamp: 4,
		},
	};
	const delegationEntry = {
		type: "custom_message",
		id: "voice-delegation",
		parentId: answerEntry.id,
		timestamp: new Date(5).toISOString(),
		customType: "gippity-realtime-delegation",
		content:
			"<realtime_delegation><input>Now inspect tests</input></realtime_delegation>",
		display: false,
		details: {},
	};
	const entries = [
		userEntry,
		workingEntry,
		toolEntry,
		answerEntry,
		delegationEntry,
	];
	const model = {
		provider: "example",
		id: "text-model",
		maxTokens: 4_096,
		reasoning: true,
	};
	const provider = {
		async *streamSimple(model: unknown, context: unknown, _options: unknown) {
			sidecarModel = model;
			sidecarContext = context;
			yield {
				type: "done",
				message: { content: [{ type: "text", text: "summary" }] },
			};
		},
	};
	const ctx = {
		sessionManager: {
			getEntries: () => entries,
			getBranch: () => entries,
			getLeafId: () => delegationEntry.id,
			getSessionId: () => "mixed-provider-session",
		},
		modelRegistry: {
			find: () => model,
			getProvider: () => provider,
			getApiKeyAndHeaders: async () => ({
				ok: true,
				apiKey: "token",
				baseUrl: "https://account.example/v1",
			}),
		},
	};

	const initialItems = await buildRealtimeInitialItems({
		ctx: ctx as never,
		config: {
			...DEFAULT_GIPPITY_CONTROL_CONFIG,
			voice: {
				...DEFAULT_GIPPITY_CONTROL_CONFIG.voice,
				contextModel: { provider: "example", modelId: "text-model" },
			},
		},
	});

	expect((sidecarContext as { tools?: unknown }).tools).toBeUndefined();
	expect((sidecarModel as { baseUrl?: string }).baseUrl).toBe(
		"https://account.example/v1",
	);
	const history = (
		sidecarContext as {
			messages: Array<{ content: Array<{ text: string }> }>;
		}
	).messages[0]!.content[0]!.text;
	expect(history).toContain("[User]: Inspect this screenshot");
	expect(history).toContain("[Assistant]: This is the final answer.");
	expect(history).toContain("[Realtime voice]: <realtime_delegation>");
	expect(history).not.toContain("private reasoning");
	expect(history).not.toContain("Checking files");
	expect(history).not.toContain("large code dump");
	expect(history).not.toContain("aW1hZ2U=");
	expect(initialItems?.[0]?.role).toBe("developer");
	expect(initialItems?.[0]?.content[0]?.text).toMatch(
		/<startup_context>\nsummary\n<\/startup_context>/,
	);
	expect(
		buildRealtimeCallRequest(
			"offer",
			DEFAULT_GIPPITY_CONTROL_CONFIG,
			"instructions",
			initialItems,
		).session,
	).toMatchObject({
		model: "gpt-live-1-codex",
		delegation: { type: "client", ack_filler: true },
		initial_items: initialItems,
	});
});
