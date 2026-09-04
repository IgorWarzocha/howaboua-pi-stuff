import test from "node:test";
import assert from "node:assert/strict";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	isCodexDeveloperMessageDetails,
	registerCodexDeveloperMessageBroker,
	sendCodexDeveloperMessage,
	trySendCodexDeveloperMessage,
	type CodexDeveloperMessageOptions,
} from "../src/developer-messages.ts";

test("developer messages preserve delivery and provider-role semantics", () => {
	const handlers = new Map<string, Set<(value: unknown) => void>>();
	const sent: Array<{ message: Record<string, unknown>; options: unknown }> = [];
	let deliveryError: Error | undefined;
	const pi = {
		events: {
			on(channel: string, handler: (value: unknown) => void) {
				const listeners = handlers.get(channel) ?? new Set();
				listeners.add(handler);
				handlers.set(channel, listeners);
				return () => listeners.delete(handler);
			},
			emit(channel: string, value: unknown) {
				for (const handler of handlers.get(channel) ?? []) handler(value);
			},
		},
		sendMessage(message: Record<string, unknown>, options: unknown) {
			if (deliveryError) throw deliveryError;
			sent.push({ message, options });
		},
	} as never;
	let active = true;
	const unregister = registerCodexDeveloperMessageBroker(pi, () => active);
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
	assert.deepEqual(bridge.prepare([persisted], false), []);
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

	deliveryError = new Error("Developer delivery failed");
	assert.throws(
		() => trySendCodexDeveloperMessage(pi, "Undeliverable"),
		/Developer delivery failed/,
	);
	deliveryError = undefined;
	active = false;
	assert.equal(trySendCodexDeveloperMessage(pi, "Inactive"), false);
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Inactive"),
		/require an active Responses adapter/,
	);
	unregister();
	assert.equal(trySendCodexDeveloperMessage(pi, "Unavailable"), false);
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Unavailable"),
		/developer messages are unavailable/,
	);
});
