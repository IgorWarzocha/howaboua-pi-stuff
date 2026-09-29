import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionContext, createEventBus, DEFAULT_COMPACTION_SETTINGS, SessionManager, type ExtensionContext, type SessionEntry, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import {
	createHistoryNotesTools,
	loadHistoryNotesThreadHint,
} from "../src/context-management/history-notes.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE } from "../src/context-management/messages.ts";
import { connectCodexContextSharing } from "../src/context-sharing.ts";
import { contextAccountScope } from "../src/context-management/agent-identity.ts";
import { registerContextSharingService } from "../src/context-management/sharing-service.ts";
import { CodexContextWindowManager, projectContextWindowBranch } from "../src/context-management/window-manager.ts";
import { projectPiCompactionEvent } from "../src/adapter/compaction/portable-summary.ts";
import { createTreeArchiveManifest } from "../src/context-management/tree-archive.ts";
import { projectTreeCheckpointBranch } from "../src/context-management/tree-checkpoint.ts";
import { fakeJwt } from "./openai-codex-test-support.ts";

const { prepareCompaction } = await import(new URL("./core/compaction/compaction.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

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
		let completedWrites = 0;
		const prepareWrite = () => () => { completedWrites += 1; return false; };
		const [, remoteNotes] = createHistoryNotesTools(pi, () => "remote", prepareWrite);
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
		const parent = SessionManager.inMemory("/repo");
		const worker = SessionManager.inMemory("/repo");
		let liveSession = parent;
		let shareSubagentContext = false;
		const sharingPi = {
			events: createEventBus(), on() {},
			appendEntry: (type: string, data: unknown) => liveSession.appendCustomEntry(type, data),
		} as never;
		const connection = connectCodexContextSharing(sharingPi);
		registerContextSharingService(sharingPi, () => ({ contextManagementMode: "remote", shareSubagentContext }), async () => { throw new Error("Remote cannot use peer storage"); });
		const service = connection.service!;
		await assert.rejects(() => service.createChild({ ...context, sessionManager: parent }, { name: "worker" }), /disabled/);
		assert.equal(parent.getEntries().length, 0, "disabled sharing cannot enroll the parent");
		shareSubagentContext = true;
		const { binding, adopt } = await service.createChild({ ...context, sessionManager: parent }, { name: "worker" });
		assert.equal(parent.getEntries().length, 0, "preparing a child cannot enroll its parent");
		shareSubagentContext = false;
		liveSession = worker;
		const shared = { ...context, sessionManager: worker, isIdle: () => true };
		await assert.rejects(() => service.bind(shared, { ...binding, accountScope: contextAccountScope("other-account") }), /parent's Codex account/);
		assert.equal(worker.getEntries().length, 0, "failed validation cannot commit an identity");
		await assert.rejects(() => service.bind({ ...context, isIdle: () => true }, binding), /fresh, idle/);
		const identity = await service.bind(shared, binding);
		liveSession = parent;
		await adopt();
		await adopt();
		assert.equal(parent.getEntries().length, 1, "parent adoption is idempotent after binding");
		liveSession = worker;
		assert.equal(identity.threadId, worker.getSessionId(), "Pi owns the worker thread ID");
		assert.equal(identity.sessionId, parent.getSessionId());
		assert.notEqual(identity.threadId, identity.sessionId);
		await service.bind(shared, binding);
		assert.equal(worker.getEntries().length, 1, "the same binding is idempotent");
		await assert.rejects(() => service.bind(shared, { ...binding, sessionId: "unrelated" }), /cannot be rebound/);
		assert.equal(service.canCreateChild(shared), false, "adopting a parent's binding does not opt into sharing further children");
		await remoteNotes.execute("shared", { action: "read_file", path: "/root/notes/proof" }, undefined, undefined, shared);
		assert.deepEqual(JSON.parse(String(request!.init.body)).context, { session_id: parent.getSessionId(), current_agent_name: binding.agentName });
		const wrongAccount = { ...shared, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true,
			apiKey: fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "other-account" } }),
			baseUrl: "https://chatgpt.com/backend-api",
		}) } } as unknown as ExtensionContext;
		await assert.rejects(() => remoteNotes.execute("wrong-account", { action: "read_file", path: "proof" }, undefined, undefined, wrongAccount), /parent's Codex account/);
		const windows = new CodexContextWindowManager(async () => undefined);
		const windowPi = { sendMessage: (message: { customType: string; content: string; display: boolean; details: unknown }) =>
			worker.appendCustomMessageEntry(message.customType, message.content, message.display, message.details) } as never;
		windows.ensureInitialized(windowPi, shared, true);
		worker.appendMessage({ role: "user", content: "retired conversation", timestamp: 1 });
		await windows.startNewWindow(windowPi, shared, { mode: "remote", trimPreviousWindow: true });
		const forkLeaf = worker.appendMessage({ role: "user", content: "kept conversation", timestamp: 2 });
		worker.createBranchedSession(forkLeaf);
		windows.ensureInitialized(windowPi, shared, true);
		const forkEntries = worker.getEntries().length;
		windows.ensureInitialized(windowPi, shared, true);
		assert.equal(worker.getEntries().length, forkEntries, "fork identity correction is persisted once");
		const forkMessages = windows.project(worker.buildSessionContext().messages, "remote", worker.getBranch());
		assert.match(JSON.stringify(forkMessages), /kept conversation/);
		assert.doesNotMatch(JSON.stringify(forkMessages), /retired conversation/);
		assert.match(String((forkMessages.at(-1) as { content: string }).content), /Agent name: \/root\n/);
		connection.dispose();
		let failedRequests = 0;
		globalThis.fetch = (async () => {
			failedRequests += 1;
			return new Response(
				JSON.stringify({ detail: "Unsupported" }),
				{ status: 400 },
			);
		}) as typeof fetch;
		await assert.rejects(
			() => remoteNotes.execute(
				"failed-note",
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
		assert.equal(failedRequests, 2);
		assert.equal(completedWrites, 1, "failed backend writes cannot confirm a checkpoint");

		const [localHistory, localNotes] = createHistoryNotesTools(pi, () => "local", prepareWrite);
		await localNotes.execute(
			"write-local-note",
			{ action: "write_file", path: "checkpoint.md", text: "progress" },
			undefined,
			undefined,
			context,
		);
		const systemMessage = {
			role: "system", content: "", timestamp: 2,
			sections: { policy: "Preserve the deployment decision", obsolete: null },
			toolsAdded: [{ name: "inspect", description: "Inspect", parameters: { type: "object" } }],
			toolsRemoved: [{ name: "old_inspect" }],
		};
		const localItems = await localHistory.execute(
			"find-prompt-update",
			{ action: "search_contents", window_id: windowId, role: "system", query: "deployment decision" },
			undefined,
			undefined,
			createContext([{
				type: "message", id: "system-entry", parentId: "user-entry",
				timestamp: new Date(2).toISOString(), message: systemMessage,
			}]),
		);
		assert.deepEqual(localItems.details.codexHistoryNotes, {
			source: "pi-session",
			items: [{
				window_id: windowId,
				item_id: "system-entry",
				role: "system",
				truncated_content: JSON.stringify(systemMessage),
				content_chars: JSON.stringify(systemMessage).length,
			}],
		});

		const localRead = await localNotes.execute(
			"read-local-note",
			{ action: "read_file", path: "/root/notes/checkpoint.md" },
			undefined,
			undefined,
			context,
		);
		assert.equal(completedWrites, 2, "local saves confirm checkpoints; reads do not");
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
		const checkpoint: SessionEntry = {
			type: "compaction", id: "checkpoint", parentId: "user-entry", timestamp: new Date(2).toISOString(),
			summary: "Cumulative checkpoint", firstKeptEntryId: "user-entry", tokensBefore: 100_000,
		};
		const hybridSummary = { ...summary, fromId: checkpoint.id };
		const hybridManifest = { ...manifest, data: createTreeArchiveManifest(windowId, "window-entry", hybridSummary as never, checkpoint.id) };
		const next = { ...boundary, id: "next-window", parentId: manifest.id,
			details: { ...windowMessage.details, id: "next-marker", contextManagement: {
				...windowMessage.details.contextManagement, currentWindowId: "window-1", previousWindowId: windowId, windowNumber: 1,
			} } };
		const active = [hybridSummary, hybridManifest, next] as SessionEntry[];
		const all = [boundary, user, checkpoint, ...active] as SessionEntry[];
		const stored = JSON.stringify(all);
		assert.equal(projectTreeCheckpointBranch(active.slice(0, -1), all).some((entry) => entry.id === checkpoint.id), false);
		const restored = projectTreeCheckpointBranch(active, all);
		assert.deepEqual(buildSessionContext([...restored]).messages.map((message) => message.role), ["compactionSummary", "user", "custom"]);
		const event: SessionBeforeCompactEvent = { type: "session_before_compact", branchEntries: active,
			preparation: prepareCompaction(active, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 1 }),
			reason: "manual", willRetry: false, signal: new AbortController().signal };
		const projected = projectPiCompactionEvent(event, [...restored]);
		assert.equal(projected.preparation.previousSummary, checkpoint.summary);
		assert.equal(projected.preparation.firstKeptEntryId, next.id, "a restored checkpoint keeps a physical Pi cut");
		assert.doesNotMatch(JSON.stringify(projected.preparation), /Hidden recovery summary/);
		const trimmed = structuredClone([...restored]);
		const marker = trimmed.find((entry) => entry.id === next.id)!;
		if (marker.type !== "custom_message") throw new Error("Missing window marker");
		marker.details = { ...windowMessage.details, contextManagement: { ...windowMessage.details.contextManagement, trimPreviousWindow: true } };
		assert.equal(projectPiCompactionEvent(event, projectContextWindowBranch(trimmed)).preparation.previousSummary, undefined);
		assert.equal(JSON.stringify(all), stored);
		assert.throws(() => projectTreeCheckpointBranch(active, all.filter((entry) => entry.id !== checkpoint.id)), /active Tree checkpoint is unavailable/);
		const superseded = [...active, { ...checkpoint, id: "new-checkpoint", parentId: next.id, firstKeptEntryId: next.id }];
		assert.doesNotThrow(() => projectTreeCheckpointBranch(superseded, superseded), "retired missing checkpoints do not block a newer one");
		const damagedRetired = superseded.map((entry) => entry.id === hybridManifest.id ? { ...entry, data: {} } : entry);
		assert.doesNotThrow(() => projectTreeCheckpointBranch(damagedRetired, damagedRetired));
		const notesOnly = [hybridSummary, hybridManifest, { ...next, details: marker.details }] as SessionEntry[];
		assert.doesNotThrow(() => projectTreeCheckpointBranch(notesOnly, notesOnly), "an explicit notes-only cut retires the missing checkpoint");

		const header = SessionManager.inMemory("/repo").getHeader()!;
		const copy = SessionManager.inMemory("/repo", undefined, [header, ...[boundary, user, ...treeBranch, next] as SessionEntry[]]);
		const leaf = copy.appendMessage({ role: "user", content: "Keep the live conversation", timestamp: 4 });
		assert.doesNotThrow(() => projectTreeCheckpointBranch(copy.getBranch(), copy.getEntries()));
		copy.createBranchedSession(leaf);
		const forkBranch = projectTreeCheckpointBranch(copy.getBranch(), copy.getEntries());
		assert.match(JSON.stringify(buildSessionContext([...forkBranch]).messages), /Keep the live conversation/);
		assert.doesNotMatch(JSON.stringify(buildSessionContext([...forkBranch]).messages), /Hidden recovery summary/);
		const [treeHistory] = createHistoryNotesTools(undefined, () => "tree");
		const forkContext = { ...context, sessionManager: copy };
		const available = await treeHistory.execute("fork-history", { action: "list_windows" }, undefined, undefined, forkContext);
		assert.deepEqual(available.details.codexHistoryNotes["unavailable_windows"], [windowId]);
		await assert.rejects(() => treeHistory.execute("missing-history", { action: "read_item", window_id: windowId, item_id: "user-entry" }, undefined, undefined, forkContext), /open the source session/);
		const live = await treeHistory.execute("live-history", { action: "read_item", window_id: "window-1", item_id: leaf }, undefined, undefined, forkContext);
		assert.match(JSON.stringify(live.content), /Keep the live conversation/);

	} finally {
		globalThis.fetch = originalFetch;
	}
});
