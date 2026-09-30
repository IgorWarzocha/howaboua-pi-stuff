import test from "node:test";
import assert from "node:assert/strict";
import { convertToLlm, SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { projectCodexDeveloperHistory } from "../src/adapter/developer-history.ts";
import { CODEX_NOTEBOOK_STATUS_TYPE, recordNotebookStatus } from "../src/adapter/notebook-status.ts";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	isCodexDeveloperMessageDetails,
	registerCodexDeveloperMessageBroker,
	sendCodexDeveloperMessage,
	tryStartCodexPreparedIdleKickoff,
	trySendCodexDeveloperMessage,
	trySendCodexDeveloperCustomMessage,
	updateCodexPreparedIdleKickoff,
} from "../src/developer-messages.ts";

test("developer messages preserve delivery and provider-role semantics", async () => {
	const handlers = new Map<string, Set<(value: unknown) => void>>();
	const sent: Array<{ message: Record<string, unknown>; options: unknown }> = [];
	const kickoffs: Array<{ content: string; options: unknown }> = [];
	const eventBus = {
		on(channel: string, handler: (value: unknown) => void) {
			const listeners = handlers.get(channel) ?? new Set();
			listeners.add(handler);
			handlers.set(channel, listeners);
			return () => listeners.delete(handler);
		},
		emit(channel: string, value: unknown) {
			for (const handler of handlers.get(channel) ?? []) handler(value);
		},
	};
	const pi = {
		events: eventBus,
		sendMessage(message: Record<string, unknown>, options: unknown) {
			sent.push({ message, options });
		},
		sendUserMessage(content: string, options: unknown) {
			kickoffs.push({ content, options });
		},
	} as never;
	let active = false;
	const unregister = registerCodexDeveloperMessageBroker(pi, () => active, () => true);
	const callerPi = { events: eventBus } as never;
	const kickoffContext = { ui: { notify() {} } } as never;

	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext), true);
	assert.equal(tryStartCodexPreparedIdleKickoff(pi, kickoffContext), true);
	assert.equal(kickoffs.length, 1);
	updateCodexPreparedIdleKickoff(pi, "agent_start");
	const wakeup = "Continue, unless awaiting for user approval.";
	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext, wakeup), true);
	assert.equal(tryStartCodexPreparedIdleKickoff(pi, kickoffContext, wakeup), true);
	assert.equal(kickoffs.length, 1);
	updateCodexPreparedIdleKickoff(pi, "agent_settled");
	assert.equal(kickoffs.length, 2);
	assert.deepEqual(kickoffs.at(-1), { content: wakeup, options: { deliverAs: "steer" } });
	updateCodexPreparedIdleKickoff(pi, "agent_start");
	updateCodexPreparedIdleKickoff(pi, "agent_settled");

	active = true;
	assert.equal(trySendCodexDeveloperMessage(pi, "Developer guidance", {
		deliverAs: "steer",
		triggerTurn: true,
	}), true);
	assert.deepEqual(sent[0]?.options, { deliverAs: "steer", triggerTurn: false });
	assert.deepEqual(kickoffs.at(-1), {
		content: "Continue.",
		options: { deliverAs: "steer" },
	});
	assert.equal(sent[0]?.message["customType"], CODEX_DEVELOPER_MESSAGE_TYPE);
	assert.equal(isCodexDeveloperMessageDetails(sent[0]?.message["details"]), true);

	const bridge = new CodexDeveloperMessageBridge();
	const persisted = {
		...sent[0]!.message,
		role: "custom",
		timestamp: 1,
	} as never;
	assert.deepEqual(bridge.prepare([persisted], false), [persisted]);
	const system = { role: "system" as const, content: "Base instructions", timestamp: 0 };
	const systemUpdate = { role: "system" as const, content: "", sections: { policy: "Updated policy" }, timestamp: 2 };
	const transcript = [system, persisted, systemUpdate];
	const originalTranscript = structuredClone(transcript);
	const promoted = bridge.prepare(transcript, true);
	assert.equal(promoted[0], system);
	assert.equal(promoted[2], systemUpdate);
	// Switching away from Responses keeps Pi's system deltas and normal custom-message conversion.
	assert.deepEqual(convertToLlm(bridge.prepare(transcript, false)), [system, {
		role: "user", content: [{ type: "text", text: "Developer guidance" }], timestamp: 1,
	}, systemUpdate]);
	assert.deepEqual(transcript, originalTranscript);
	const [carrier] = bridge.prepare([persisted], true) as Array<{ content: string }>;
	assert.deepEqual(
		bridge.rewritePayload({
			input: [{
				role: "user",
				content: [{ type: "input_text", text: carrier!.content }],
			}],
		}),
		{
			input: [{
				role: "developer",
				content: [{ type: "input_text", text: "Developer guidance" }],
			}],
		},
	);

	const custom = {
		customType: "extension-state",
		content: "Orchestrate",
		display: false,
		details: { enabled: true, response: "Full report" },
	};
	const original = structuredClone(custom);
	assert.equal(trySendCodexDeveloperCustomMessage(pi, custom, { triggerTurn: false }), true);
	assert.deepEqual(custom, original);
	const saved = sent.at(-1)!.message;
	const customBridge = new CodexDeveloperMessageBridge();
	const [customCarrier] = customBridge.prepare([
		{ ...saved, role: "custom", timestamp: 2 },
	] as never, true) as Array<{ content: string }>;
	assert.deepEqual(customBridge.rewritePayload({
		input: [{ role: "user", content: customCarrier!.content }],
	}), { input: [{ role: "developer", content: custom.content }] });
	assert.throws(
		() => trySendCodexDeveloperCustomMessage(pi, { ...custom, details: saved["details"] as object }),
		/reserved/,
	);

	active = false;
	assert.equal(trySendCodexDeveloperMessage(pi, "Inactive"), false);
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Inactive"),
		/require an active Responses adapter/,
	);
	unregister();
	assert.equal(trySendCodexDeveloperMessage(pi, "Unavailable"), false);

	// Admission metadata must be durable without a message queue or another kickoff.
	const sessionManager = SessionManager.inMemory("/repo");
	const notebookPi = { appendEntry: (type: string, data: unknown) => { sessionManager.appendCustomEntry(type, data); } };
	const notebookContext: ExtensionContext = { sessionManager } as never;
	const state: { notebookStatusMessageId?: string } = {};
	let samples = 0;
	const codeMode = { notebookStatus: async () => ({ message: `Retained state ${++samples}`, details: {} }) };
	const projected = () => projectCodexDeveloperHistory(sessionManager.getBranch(), sessionManager.buildSessionContext().messages);
	assert.equal(await recordNotebookStatus(notebookPi, notebookContext, state, projected(), codeMode), true);
	assert.equal(sessionManager.getEntries().length, 1);
	assert.equal(sessionManager.getBranch()[0]?.type, "custom");
	assert.equal(projected()[0]?.role, "custom");
	assert.equal(await recordNotebookStatus(notebookPi, notebookContext, state, projected(), codeMode), false);
	assert.equal(samples, 1, "visible current status is reused without refreshing a live inventory every turn");
	const kept = sessionManager.appendMessage({ role: "user", content: "Continue", timestamp: 1 });
	sessionManager.appendCompaction("Checkpoint", kept, 100_000);
	assert.equal(await recordNotebookStatus(notebookPi, notebookContext, state, projected(), codeMode), true);
	assert.equal(samples, 2, "stored but compacted-out status cannot suppress renewal");
	const notebookMessages = projected();
	assert.equal(notebookMessages.filter((message) => message.role === "custom" && message.customType === CODEX_NOTEBOOK_STATUS_TYPE).length, 1);
	const notebookBridge = new CodexDeveloperMessageBridge();
	assert.deepEqual(notebookBridge.prepare(notebookMessages, false), notebookMessages);
	const preparedNotebook = notebookBridge.prepare(notebookMessages, true);
	assert.equal(convertToLlm(preparedNotebook).at(-1)?.role, "user");
	const notebookCarrier = preparedNotebook.find((message) => message.role === "custom" && message.customType === CODEX_NOTEBOOK_STATUS_TYPE);
	assert.ok(notebookCarrier && notebookCarrier.role === "custom");
	assert.deepEqual(notebookBridge.rewritePayload({ input: [{ role: "user", content: notebookCarrier.content }] }), {
		input: [{ role: "developer", content: "Retained state 2" }],
	});
});
