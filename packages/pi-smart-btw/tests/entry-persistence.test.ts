import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MESSAGE_TYPE } from "../src/constants.js";
import { sendClearedMessage, sendResultMessage } from "../src/messages.js";
import type { BtwSession, BtwTurn } from "../src/types.js";

function recorder() {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
		sendMessage() {
			throw new Error("BTW persistence must not use model-facing messages");
		},
	} as unknown as ExtensionAPI;
	return { entries, pi };
}

const session = {
	index: 1,
	generationId: "generation",
	turns: [],
} as unknown as BtwSession;
const turn = {
	question: "Why?",
	answer: "Because.",
	startedAt: 1,
	finishedAt: 2,
	turnIndex: 3,
} as BtwTurn;

test("persists results and clear markers as display-only entries", () => {
	const { entries, pi } = recorder();
	sendResultMessage(pi, session, turn);
	sendClearedMessage(pi, session);

	expect(entries).toHaveLength(2);
	expect(entries[0]).toEqual({
		customType: MESSAGE_TYPE,
		data: expect.objectContaining({
			kind: "result",
			question: "Why?",
			answer: "Because.",
		}),
	});
	expect(entries[1]).toEqual({
		customType: MESSAGE_TYPE,
		data: expect.objectContaining({ kind: "cleared" }),
	});
});
