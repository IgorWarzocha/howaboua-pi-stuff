import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryNotesTools } from "../src/context-management/history-notes.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE } from "../src/context-management/messages.ts";
import { fakeJwt } from "./openai-codex-test-support.ts";

const windowId = "window-0";
const windowMessage = {
	customType: CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	content: "First context window",
	display: true,
	details: {
		protocol: 1,
		id: "window-message",
		contextManagement: {
			protocol: 1,
			kind: "window",
			firstWindowId: windowId,
			currentWindowId: windowId,
			windowNumber: 0,
		},
	},
};

function createContext() {
	return {
		cwd: "/repo",
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.6",
			baseUrl: "https://chatgpt.com/backend-api",
		},
		sessionManager: {
			getSessionId: () => "session-context",
			getBranch: () => [
				{
					type: "custom_message",
					id: "window-entry",
					parentId: null,
					timestamp: new Date(0).toISOString(),
					...windowMessage,
				},
				{
					type: "message",
					id: "user-entry",
					parentId: "window-entry",
					timestamp: new Date(1).toISOString(),
					message: {
						role: "user",
						content: "recover me",
						timestamp: 1,
					},
				},
			],
		},
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({
				ok: true,
				apiKey: fakeJwt({
					"https://api.openai.com/auth": {
						chatgpt_account_id: "account-1",
					},
				}),
				baseUrl: "https://chatgpt.com/backend-api",
			}),
		},
	} as never;
}

test("history and notes preserve remote encryption and sticky local recovery", async () => {
	const originalFetch = globalThis.fetch;
	let request: { url: string; init: RequestInit } | undefined;
	try {
		globalThis.fetch = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			request = { url: String(input), init: init ?? {} };
			return new Response(
				JSON.stringify({ encrypted_output: "encrypted-note" }),
				{ status: 200 },
			);
		}) as typeof fetch;
		const context = createContext();
		const [history, notes] = createHistoryNotesTools();
		const noteResult = await notes.execute(
			"write-note",
			{ action: "write_file", path: "checkpoint.md", text: "progress" },
			undefined,
			undefined,
			context,
		);
		assert.deepEqual(noteResult.details, {
			codexHistoryNotes: { encrypted_output: "encrypted-note" },
		});
		assert.equal(
			request?.url,
			"https://chatgpt.com/backend-api/codex/alpha/notes/v2/write_file",
		);
		assert.equal(
			new Headers(request?.init.headers).get(
				"x-openai-encrypted-tool-arguments",
			),
			"true",
		);
		assert.deepEqual(JSON.parse(String(request?.init.body)), {
			path: "checkpoint.md",
			text: "progress",
			context: {
				session_id: "session-context",
				current_agent_name: "/root",
			},
		});
		await assert.rejects(
			() => notes.execute(
				"invalid-note",
				{
					action: "write_file",
					path: "checkpoint.md",
					text: "progress",
					query: "irrelevant",
				},
				undefined,
				undefined,
				context,
			),
			/notes write_file does not accept query/,
		);

		globalThis.fetch = (async () => new Response(
			JSON.stringify({ detail: "Not found" }),
			{ status: 404 },
		)) as typeof fetch;
		await assert.rejects(
			() => notes.execute(
				"fallback-note",
				{ action: "write_file", path: "checkpoint.md", text: "progress" },
				undefined,
				undefined,
				context,
			),
			/Retry notes with action write_file/,
		);
		const fallback = await history.execute(
			"list-old-window",
			{ action: "list_items", window_id: windowId },
			undefined,
			undefined,
			context,
		);
		assert.deepEqual(fallback.details.codexHistoryNotes, {
			source: "pi-session",
			items: [{
				window_id: windowId,
				item_id: "user-entry",
				role: "user",
				truncated_content: "recover me",
				content_chars: 10,
			}],
		});

		const entries: Array<Record<string, unknown>> = [];
		const localPi = {
			appendEntry(customType: string, data: unknown) {
				entries.push({
					type: "custom",
					id: "note-" + (entries.length + 1),
					parentId: null,
					timestamp: new Date(entries.length).toISOString(),
					customType,
					data,
				});
			},
		} as never;
		const localContext = {
			cwd: "/repo",
			model: {
				provider: "passthrough",
				api: "openai-responses",
				id: "gpt-5.6",
			},
			sessionManager: {
				getSessionId: () => "session-local-notes",
				getBranch: () => entries,
			},
		} as never;
		const [, localNotes] = createHistoryNotesTools(localPi, () => "local");
		await localNotes.execute(
			"write-local-note",
			{ action: "write_file", path: "checkpoint.md", text: "progress" },
			undefined,
			undefined,
			localContext,
		);
		await localNotes.execute(
			"append-local-note",
			{ action: "append_to_file", path: "checkpoint.md", text: "\nnext" },
			undefined,
			undefined,
			localContext,
		);
		const localRead = await localNotes.execute(
			"read-local-note",
			{ action: "read_file", path: "/root/notes/checkpoint.md" },
			undefined,
			undefined,
			localContext,
		);
		assert.equal(
			(localRead.details.codexHistoryNotes["file"] as { content: string })
				.content,
			"progress\nnext",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
