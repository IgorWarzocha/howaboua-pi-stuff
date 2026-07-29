import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionMessage,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { REVIEW_PREFACE_MESSAGE_TYPE } from "../src/constants.js";
import { sendReviewPreface } from "../src/messages.js";

test("a fresh review loop reissues a surviving preface", () => {
	const sessionManager = SessionManager.inMemory(process.cwd());
	const pi = {
		sendMessage(message: ExtensionMessage) {
			sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
		},
	} as ExtensionAPI;
	const ctx = { sessionManager } as ExtensionCommandContext;
	const prefaces = () =>
		sessionManager
			.buildContextEntries()
			.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === REVIEW_PREFACE_MESSAGE_TYPE,
			);

	sendReviewPreface(pi, ctx);
	sendReviewPreface(pi, ctx);
	expect(prefaces()).toHaveLength(1);

	sendReviewPreface(pi, ctx, { freshLoop: true });
	expect(prefaces()).toHaveLength(2);
});
