import test from "node:test";
import assert from "node:assert/strict";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	isCodexDeveloperMessageDetails,
	registerCodexDeveloperMessageBroker,
	sendCodexDeveloperMessage,
	type CodexDeveloperMessageOptions,
} from "../src/developer-messages.ts";

test("developer messages preserve delivery and provider-role semantics", () => {
	const handlers = new Map<string, Set<(value: unknown) => void>>();
	const sent: Array<{ message: Record<string, unknown>; options: unknown }> = [];
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
	for (const [index, options] of deliveries.entries())
		sendCodexDeveloperMessage(pi, "Developer " + index, options);

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

	active = false;
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Inactive"),
		/require an active Responses adapter/,
	);
	unregister();
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Unavailable"),
		/developer messages are unavailable/,
	);
});
