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
	type CodexDeveloperMessageOptions,
} from "../src/developer-messages.ts";

test("developer messages preserve delivery and provider-role semantics", () => {
	const handlers = new Map<string, Set<(value: unknown) => void>>();
	const sent: Array<{ message: Record<string, unknown>; options: unknown }> = [];
	const kickoffs: Array<{ content: string; options: unknown }> = [];
	const notifications: string[] = [];
	let deliveryError: Error | undefined;
	let kickoffError: Error | undefined;
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
			if (deliveryError) throw deliveryError;
			sent.push({ message, options });
		},
		sendUserMessage(content: string, options: unknown) {
			if (kickoffError) throw kickoffError;
			kickoffs.push({ content, options });
		},
	} as never;
	let active = false;
	const unregister = registerCodexDeveloperMessageBroker(pi, () => active);
	const callerPi = { events: eventBus } as never;
	const kickoffContext = {
		ui: { notify: (message: string) => notifications.push(message) },
	} as never;
	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext), true);
	assert.equal(tryStartCodexPreparedIdleKickoff(pi, kickoffContext), true);
	assert.deepEqual(kickoffs, [{
		content: "Continue.",
		options: { deliverAs: "steer" },
	}], "facades sharing Pi's event bus claim one prepared kickoff");
	assert.match(notifications[0]!, /send a user message or reload the session/);
	updateCodexPreparedIdleKickoff(pi, "agent_settled");
	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext), true);
	assert.equal(kickoffs.length, 1,
		"a settlement cannot release a claim created during its own handlers");
	updateCodexPreparedIdleKickoff(pi, "agent_start");
	updateCodexPreparedIdleKickoff(pi, "agent_settled");
	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext), true,
		"lifecycle owners can release an orphaned claim");
	updateCodexPreparedIdleKickoff(callerPi, "session_reset");
	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext), true,
		"a facade sharing Pi's event bus can release the claim");
	assert.equal(kickoffs.length, 3);
	updateCodexPreparedIdleKickoff(pi, "session_reset");
	kickoffError = new Error("Prepared kickoff failed");
	assert.throws(
		() => tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext),
		/Prepared kickoff failed/,
	);
	kickoffError = undefined;
	assert.equal(tryStartCodexPreparedIdleKickoff(callerPi, kickoffContext), true,
		"a synchronous failure releases the claim without falling back");
	assert.equal(kickoffs.length, 4);
	active = true;
	const deliveries = [
		{ deliverAs: "steer", triggerTurn: true },
		{ deliverAs: "followUp", triggerTurn: false },
		{ deliverAs: "nextTurn", triggerTurn: true },
	] satisfies CodexDeveloperMessageOptions[];
	assert.equal(
		trySendCodexDeveloperMessage(pi, "Developer 0", deliveries[0]),
		true,
	);
	for (let index = 1; index < deliveries.length; index++)
		sendCodexDeveloperMessage(pi, "Developer " + index, deliveries[index]);

	assert.deepEqual(sent.map(({ options }) => options), deliveries);
	assert.equal(
		sent.every(({ message }) =>
			message["customType"] === CODEX_DEVELOPER_MESSAGE_TYPE &&
			message["display"] === true &&
			isCodexDeveloperMessageDetails(message["details"])
		),
		true,
	);

	const bridge = new CodexDeveloperMessageBridge();
	const persisted = {
		...sent[0]!.message,
		role: "custom",
		timestamp: 1,
	} as never;
	assert.deepEqual(bridge.prepare([persisted], false), [persisted]);
	const [carrier] = bridge.prepare([persisted], true) as Array<{
		content: string;
	}>;
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
				content: [{ type: "input_text", text: "Developer 0" }],
			}],
		},
	);

	// Switching away preserves the original content; switching back promotes it again.
	assert.deepEqual(bridge.prepare([persisted], false), [persisted]);
	assert.deepEqual(bridge.prepare([persisted], true), [carrier]);

	const custom = { customType: "extension-state", content: "Orchestrate", display: false,
		details: { enabled: true, response: "Full report", nested: { task: "Original task" } } };
	const original = structuredClone(custom);
	assert.equal(trySendCodexDeveloperCustomMessage(pi, custom, { triggerTurn: false }), true);
	assert.deepEqual(custom, original);
	const saved = JSON.parse(JSON.stringify(sent.at(-1)!.message));
	assert.equal(saved.customType, custom.customType);
	assert.equal(saved.display, false);
	for (const [key, value] of Object.entries(custom.details)) assert.deepEqual(saved.details[key], value);
	assert.deepEqual(sent.at(-1)!.options, { triggerTurn: false });
	const restored = { ...saved, role: "custom", timestamp: 2 };
	const freshBridge = new CodexDeveloperMessageBridge();
	const [customCarrier] = freshBridge.prepare([restored], true) as Array<{ content: string }>;
	assert.deepEqual(freshBridge.rewritePayload({ input: [{ role: "user", content: customCarrier!.content }] }),
		{ input: [{ role: "developer", content: custom.content }] });
	assert.deepEqual(freshBridge.prepare([restored], false), [restored]);
	assert.deepEqual(freshBridge.prepare([restored], true), [customCarrier]);
	assert.throws(() => trySendCodexDeveloperCustomMessage(pi, { ...custom, details: saved.details }), /reserved/);
	assert.throws(() => trySendCodexDeveloperCustomMessage(pi, { ...custom, details: [] }), /plain object/);

	deliveryError = new Error("Developer delivery failed");
	assert.throws(() => trySendCodexDeveloperCustomMessage(pi, custom), /Developer delivery failed/);
	assert.throws(
		() => trySendCodexDeveloperMessage(pi, "Undeliverable"),
		/Developer delivery failed/,
	);
	deliveryError = undefined;
	active = false;
	const sentCount = sent.length;
	assert.equal(trySendCodexDeveloperCustomMessage(pi, custom), false);
	assert.equal(sent.length, sentCount);
	assert.equal(trySendCodexDeveloperMessage(pi, "Inactive"), false);
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Inactive"),
		/require an active Responses adapter/,
	);
	unregister();
	// A legacy broker must never consume a request that requires caller identity.
	let legacyCalled = false;
	handlers.set("@howaboua/pi-codex-conversion.developer-message/v1", new Set([() => { legacyCalled = true; }]));
	assert.equal(trySendCodexDeveloperCustomMessage(pi, custom), false);
	assert.equal(legacyCalled, false);
	assert.equal(sent.length, sentCount);
	assert.equal(trySendCodexDeveloperMessage(pi, "Unavailable"), false);
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Unavailable"),
		/developer messages are unavailable/,
	);
});
