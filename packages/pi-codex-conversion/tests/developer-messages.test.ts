import test from "node:test";
import assert from "node:assert/strict";
import { convertToLlm, SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { projectCodexDeveloperHistory } from "../src/adapter/developer-history.ts";
import { CODEX_NOTEBOOK_STATUS_TYPE, recordNotebookStatus } from "../src/adapter/notebook-status.ts";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { REMOTE_DELIVERY_MESSAGE, appendRemoteDelivery, readRemoteDelivery, remoteDeliveryItems } from "../src/context-management/remote-delivery.ts";
import { remoteContextScope } from "../src/context-management/remote-scope.ts";
import { contextAgentIdentity } from "../src/context-management/agent-identity.ts";
import { normalizeResponsesToolHistory } from "../src/providers/openai-responses/tool-history.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
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
	const lifecycle = new Map<string, (event: { reason: string }, ctx: ExtensionContext) => void>();
	const deliveryManager = SessionManager.inMemory("/repo");
	const deliveryContext = { sessionManager: deliveryManager, ui: { notify() {} } } as never;
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
		on(event: string, handler: (event: { reason: string }, ctx: ExtensionContext) => void) { lifecycle.set(event, handler); },
		appendEntry(type: string, data: unknown) { deliveryManager.appendCustomEntry(type, data); },
		sendMessage(message: Record<string, unknown>, options: unknown) {
			sent.push({ message, options });
		},
		sendUserMessage(content: string, options: unknown) {
			kickoffs.push({ content, options });
		},
	} as never;
	let active = false;
	let idle = true;
	const unregister = registerCodexDeveloperMessageBroker(pi, () => active, () => idle);
	lifecycle.get("session_start")!({ reason: "startup" }, deliveryContext);
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
	assert.deepEqual(sent[0]?.options, { deliverAs: "nextTurn", triggerTurn: false });
	assert.deepEqual(kickoffs.at(-1), {
		content: "Continue.",
		options: { deliverAs: "steer" },
	});
	assert.equal(sent[0]?.message["customType"], CODEX_DEVELOPER_MESSAGE_TYPE);
	assert.equal(isCodexDeveloperMessageDetails(sent[0]?.message["details"]), true);
	idle = false;
	const activeKickoffs = kickoffs.length;
	assert.equal(trySendCodexDeveloperMessage(pi, "During native navigation", { deliverAs: "steer", triggerTurn: true }), true);
	assert.deepEqual(sent.at(-1)?.options, { deliverAs: "nextTurn", triggerTurn: false });
	assert.equal(kickoffs.length, activeKickoffs);
	updateCodexPreparedIdleKickoff(pi, "agent_start");
	assert.equal(trySendCodexDeveloperMessage(pi, "Active steering", { deliverAs: "steer", triggerTurn: true }), true);
	assert.deepEqual(sent.at(-1)?.options, { deliverAs: "steer", triggerTurn: true });
	assert.equal(kickoffs.length, activeKickoffs);
	idle = true;

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
	assert.deepEqual(sent.at(-1)?.options, { triggerTurn: false });
	assert.equal(kickoffs.length, activeKickoffs, "persistent state alone must not start a turn");
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
	assert.equal(deliveryManager.buildSessionContext().messages.length, 0, "pending deliveries are durable metadata, not new conversation");
	deliveryManager.appendCustomMessageEntry(CODEX_DEVELOPER_MESSAGE_TYPE, "Developer guidance", true, sent[0]!.message["details"]);
	const beforeRestore = sent.length;
	lifecycle.get("session_start")!({ reason: "reload" }, deliveryContext);
	assert.equal(sent.length, beforeRestore, "in-place reload retains Pi's queue without duplicating it");
	lifecycle.get("session_start")!({ reason: "startup" }, deliveryContext);
	assert.equal(sent.length, beforeRestore + 1, "replacement restores only unconsumed delivery IDs");
	assert.equal(sent.at(-1)?.message["content"], "During native navigation");
	assert.deepEqual(sent.at(-1)?.options, { deliverAs: "nextTurn", triggerTurn: false });

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

	{
		const sessionManager = SessionManager.inMemory("/repo");
		const ctx: ExtensionContext = { sessionManager } as never;
		const scope = remoteContextScope(contextAgentIdentity(ctx), "account", "https://chatgpt.com/backend-api/codex");
		const assistant: AssistantMessage = { role: "assistant", content: [], stopReason: "toolUse", timestamp: 1,
			api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6-luna",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
		const originalExecCallId = "original|ctc_original";
		const initial = readRemoteDelivery({ protocol: 2, origin: "host", id: "00000000-0000-4000-8000-000000000001",
			sourceCallId: originalExecCallId, originalExecCallId, cellId: "cell", scope, status: "yielded", images: [],
			outputs: [{ resultId: "nested-a", name: "notes.read_file", encryptedOutput: "cipher-a" },
				{ resultId: "nested-b", name: "history.read_item", encryptedOutput: "cipher-b" }] });
		const resumed = readRemoteDelivery({ ...initial, id: "00000000-0000-4000-8000-000000000002", sourceCallId: "wait-call",
			status: "result", outputs: [{ resultId: "nested-c", name: "notes.read_file", encryptedOutput: "cipher-c" }] });
		const persist = (delivery: typeof initial, name: "exec" | "wait") => {
			sessionManager.appendMessage({ ...assistant, content: [{ type: "toolCall", id: delivery.sourceCallId, name,
				arguments: name === "exec" ? { code: "ordinary source" } : {} }] });
			sessionManager.appendMessage({ role: "toolResult", toolCallId: delivery.sourceCallId, toolName: name,
				content: [{ type: "text", text: "receipt" }], isError: false, timestamp: 2,
				details: { codeMode: true, cellId: delivery.cellId, status: delivery.status, opaqueDeliveryId: delivery.id } });
			sessionManager.appendCustomMessageEntry(REMOTE_DELIVERY_MESSAGE, "Remote results", false, delivery);
		};
		persist(initial, "exec"); persist(resumed, "wait");
		const bridge = new CodexDeveloperMessageBridge();
		const carriers = bridge.prepare(sessionManager.buildSessionContext().messages, true).flatMap(message =>
			message.role === "custom" ? [{ role: "user", content: message.content }] : []);
		const exec = { type: "custom_tool_call", id: "ctc_original", call_id: "original", name: "exec", input: "ordinary source" };
		const receipt = { type: "custom_tool_call_output", call_id: "original", output: "ordinary receipt" };
		const wait = { type: "function_call", call_id: "wait-call", name: "wait", arguments: "{}" };
		const waitReceipt = { type: "function_call_output", call_id: "wait-call", output: "ordinary wait receipt" };
		const originals = JSON.stringify([exec, receipt, wait, waitReceipt]);
		const payload = bridge.rewritePayload({ input: [exec, receipt, carriers[0], wait, waitReceipt, carriers[1]] }) as { input: unknown[] };
		assert.deepEqual(payload.input, [exec, receipt, ...remoteDeliveryItems(initial), wait, waitReceipt, ...remoteDeliveryItems(resumed)]);
		assert.deepEqual(normalizeResponsesToolHistory(payload.input), payload.input, "encrypted cross-kind outputs and the ordinary receipt coexist");
		assert.equal(JSON.stringify([exec, receipt, wait, waitReceipt]), originals);
		await bridge.validateRemotePayload(payload, () => "account", ctx, false, "https://chatgpt.com/backend-api");
		await new CodexDeveloperMessageBridge().validateRemotePayload(payload, () => "account", ctx, false, "https://chatgpt.com/backend-api");
		const normalInput = serializeMessagesToResponsesInput({ id: assistant.model, provider: assistant.provider,
			api: assistant.api, input: ["text"], reasoning: true } as never, sessionManager.buildSessionContext().messages,
			{ grammarToolInputProperties: new Map() });
		assert.deepEqual(normalInput.filter(item => "type" in item && item.type === "custom_tool_call"), [exec]);
		assert.deepEqual(normalInput.filter(item => "type" in item && item.type === "custom_tool_call_output"), [
			{ type: "custom_tool_call_output", call_id: "original", output: "receipt" },
		]);
		assert.deepEqual(normalInput.filter(item => "type" in item && item.type === "function_call_output" && Array.isArray(item.output)),
			[...remoteDeliveryItems(initial), ...remoteDeliveryItems(resumed)]);
		await new CodexDeveloperMessageBridge().validateRemotePayload({ input: normalInput }, () => "account", ctx);
		await assert.rejects(bridge.validateRemotePayload(payload, () => "foreign", ctx), /different Codex account/);
		await assert.rejects(bridge.validateRemotePayload(payload, () => "account", ctx, false, "https://proxy.invalid"), /different backend/);
		await assert.rejects(bridge.validateRemotePayload({ input: [exec, ...remoteDeliveryItems(initial), receipt] }, () => "account", ctx), /original exec receipt/);
		const changed = structuredClone(payload);
		(changed.input[2] as { output: unknown }).output = [{ type: "encrypted_content", encrypted_content: "tampered" }];
		await assert.rejects(bridge.validateRemotePayload(changed, () => "account", ctx), /changed content/);
		await assert.rejects(bridge.validateRemotePayload({ input: payload.input.filter(item => item !== payload.input[2]) }, () => "account", ctx),
			/partially removed/, "a selected cut cannot leave part of an exec relay group");
		await assert.rejects(bridge.validateRemotePayload({ input: [exec, receipt, wait, waitReceipt] }, () => "account", ctx), /partially removed/);
		assert.throws(() => appendRemoteDelivery({ sendMessage() { assert.fail("An orphaned pending delivery cannot be queued"); } } as never,
			{ kind: "result", cellId: "cell", originalExecCallId: "removed", contentItems: [], opaqueOutputs: initial.outputs }, "wait-call", scope, ctx),
			/original exec was removed/, "fresh pending output never claims delivery after its origin was cut");
		assert.throws(() => normalizeResponsesToolHistory(payload.input.slice(1)), /ancestry/);
		assert.throws(() => normalizeResponsesToolHistory([...payload.input, payload.input[2]]), /duplicate/);
		assert.throws(() => normalizeResponsesToolHistory([{ type: "function_call", name: "exec", call_id: "original", arguments: "{}" },
			{ type: "function_call_output", call_id: "original", output: "ordinary receipt" }, ...remoteDeliveryItems(initial)]),
			/recorded custom exec call/, "a mode projection cannot silently discard encrypted relay output");
		assert.deepEqual(new CodexDeveloperMessageBridge().prepare(sessionManager.buildSessionContext().messages.filter(message => message.role === "custom"), true), [],
			"selected cuts discard relays with their removed original calls rather than fabricate calls");
		assert.deepEqual(remoteDeliveryItems(readRemoteDelivery({ ...resumed, outputs: [], contextNotesSaved: true })), []);
		const legacy = readRemoteDelivery({ protocol: 1, origin: "host", id: initial.id, sourceCallId: originalExecCallId,
			cellId: "cell", scope, status: "yielded", images: [], outputs: initial.outputs });
		assert.deepEqual(remoteDeliveryItems(legacy), [{ type: "function_call", id: "fc_host_delivery_00000000000040008000000000000001",
			call_id: "host_delivery_00000000000040008000000000000001", name: "_pi_remote_delivery",
			arguments: '{"origin":"host","source_call_id":"original|ctc_original","cell_id":"cell"}' },
		{ type: "function_call_output", call_id: "host_delivery_00000000000040008000000000000001", output: [
			{ type: "input_text", text: "Remote results" }, { type: "input_text", text: "Result nested-a (notes.read_file)" },
			{ type: "encrypted_content", encrypted_content: "cipher-a" }, { type: "input_text", text: "Result nested-b (history.read_item)" },
			{ type: "encrypted_content", encrypted_content: "cipher-b" },
		] }], "legacy persisted protocol projects byte-identical stable pairs");
		const image = { type: "image" as const, mimeType: "image/png", data: "AQ==" };
		const [textOnly] = remoteDeliveryItems(initial) as Array<{ output: unknown[] }>;
		assert.deepEqual(remoteDeliveryItems({ ...initial, images: [image] }), [{ ...textOnly,
			output: [...textOnly!.output, { type: "input_image", detail: "high", image_url: "data:image/png;base64,AQ==" }] }]);
		assert.deepEqual(remoteDeliveryItems({ ...initial, images: [image] }, true), [{ ...textOnly,
			output: [...textOnly!.output, { type: "input_text", text: "Image reading is disabled." }] }]);
	}
});
