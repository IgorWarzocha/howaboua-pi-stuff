import test from "node:test";
import assert from "node:assert/strict";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
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

test("developer messages preserve delivery and provider-role semantics", () => {
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
	updateCodexPreparedIdleKickoff(pi, "agent_settled");
	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext), true);
	assert.equal(kickoffs.length, 2);

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
});
