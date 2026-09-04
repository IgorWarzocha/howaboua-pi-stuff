import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createHistoryNotesTools,
	loadHistoryNotesThreadHint,
} from "../src/context-management/history-notes.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE } from "../src/context-management/messages.ts";
import { createTreeArchiveManifest } from "../src/context-management/tree-archive.ts";
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

function createContext(noteEntries: readonly Record<string, unknown>[]) {
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
				...noteEntries,
			],
			getEntries() {
				return this.getBranch();
			},
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
	} as unknown as ExtensionContext;
}

test("remote context storage is exact while local storage stays in Pi", async () => {
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
		const noteEntries: Array<Record<string, unknown>> = [];
		const pi = {
			appendEntry(customType: string, data: unknown) {
				noteEntries.push({
					type: "custom",
					id: "note-" + (noteEntries.length + 1),
					parentId: null,
					timestamp: new Date(noteEntries.length).toISOString(),
					customType,
					data,
				});
			},
		} as never;
		const context = createContext(noteEntries);
		const [, remoteNotes] = createHistoryNotesTools(pi, () => "remote");
		const noteResult = await remoteNotes.execute(
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
		let failedRequests = 0;
		globalThis.fetch = (async () => {
			failedRequests += 1;
			return new Response(
				JSON.stringify({ detail: "Unsupported" }),
				{ status: 400 },
			);
		}) as typeof fetch;
		for (let attempt = 0; attempt < 2; attempt += 1)
			await assert.rejects(
				() => remoteNotes.execute(
					`failed-note-${attempt}`,
					{ action: "write_file", path: "checkpoint.md", text: "progress" },
					undefined,
					undefined,
					context,
				),
				/History and notes backend failed \(400\)/,
			);
		assert.equal(
			await loadHistoryNotesThreadHint(context, "remote"),
			undefined,
		);
		assert.equal(failedRequests, 3);

		const [localHistory, localNotes] = createHistoryNotesTools(pi, () => "local");
		await localNotes.execute(
			"write-local-note",
			{ action: "write_file", path: "checkpoint.md", text: "progress" },
			undefined,
			undefined,
			context,
		);
		const localItems = await localHistory.execute(
			"list-old-window",
			{ action: "list_items", window_id: windowId },
			undefined,
			undefined,
			context,
		);
		assert.deepEqual(localItems.details.codexHistoryNotes, {
			source: "pi-session",
			items: [{
				window_id: windowId,
				item_id: "user-entry",
				role: "user",
				truncated_content: "recover me",
				content_chars: 10,
			}],
		});

		const localRead = await localNotes.execute(
			"read-local-note",
			{ action: "read_file", path: "/root/notes/checkpoint.md" },
			undefined,
			undefined,
			context,
		);
		assert.equal(
			(localRead.details.codexHistoryNotes["file"] as { content: string })
				.content,
			"progress",
		);
		assert.equal(
			await loadHistoryNotesThreadHint(context, "local"),
			'Recent notes (up to 5, most-recent first):\n- /root/notes/checkpoint.md (1 line, 8 UTF-8 bytes)\nPrevious window history IDs: {"window_id":"window-0","user_item_ids":["user-entry"]}',
		);

		const [boundary, user] = context.sessionManager.getBranch();
		const summary = {
			type: "branch_summary",
			id: "tree-summary",
			parentId: null,
			fromId: "user-entry",
			summary: "Hidden recovery summary",
			timestamp: new Date(2).toISOString(),
		};
		const manifest = {
			type: "custom",
			id: "tree-manifest",
			parentId: summary.id,
			timestamp: new Date(3).toISOString(),
			customType: "codex-context-tree-archive",
			data: createTreeArchiveManifest(
				windowId,
				"window-entry",
				summary as never,
			),
		};
		const note = { ...noteEntries.at(-1)!, parentId: manifest.id };
		const treeBranch = [summary, manifest, note];
		const treeContext = {
			...context,
			sessionManager: {
				...context.sessionManager,
				getBranch: () => treeBranch,
				getEntries: () => [boundary, user, ...treeBranch],
			},
		} as unknown as ExtensionContext;
		assert.equal(
			await loadHistoryNotesThreadHint(treeContext, "tree"),
			'Recent notes (up to 5, most-recent first):\n- /root/notes/checkpoint.md (1 line, 8 UTF-8 bytes)\nPrevious window history IDs: {"window_id":"window-0","summary_item_id":"tree-summary","user_item_ids":["user-entry"]}',
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
