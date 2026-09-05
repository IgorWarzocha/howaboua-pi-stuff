import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { PENDING_ASK_ENTRY_TYPE, readPendingAsks } from "../ask/pending.js";
import {
	createPromptState,
	promptStateResponded,
	promptStatesToResponses,
	saveComment,
} from "../ask/state.js";

describe("prompt comments", () => {
	test("are optional but count as a response when present", () => {
		const state = createPromptState();
		expect(promptStateResponded(state)).toBe(false);

		saveComment(state, " Needs a smaller first pass. ");

		expect(promptStateResponded(state)).toBe(true);
		expect(promptStatesToResponses([{ id: "scope" }], [state])).toEqual([
			{
				id: "scope",
				selections: [],
				comment: "Needs a smaller first pass.",
			},
		]);
	});
});

describe("pending steering asks", () => {
	test("restores only unresolved valid requests", () => {
		const customEntry = (id: string, data: unknown): SessionEntry => ({
			type: "custom",
			id,
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			customType: PENDING_ASK_ENTRY_TYPE,
			data,
		});
		const entries = [
			customEntry("e1", {
				version: 1,
				state: "pending",
				id: "closed",
				prompts: [{ title: "Old question" }],
			}),
			customEntry("e2", {
				version: 1,
				state: "pending",
				id: "open",
				prompts: [
					{ title: " Current question ", choices: [{ label: " Yes " }] },
				],
			}),
			customEntry("e3", { version: 1, state: "closed", id: "closed" }),
			customEntry("e4", {
				version: 1,
				state: "pending",
				id: "invalid",
				prompts: [],
			}),
		];

		expect(readPendingAsks(entries)).toEqual([
			{
				id: "open",
				prompts: [
					{
						id: "p1",
						title: "Current question",
						multiple: false,
						choices: [{ label: "Yes" }],
					},
				],
			},
		]);
	});
});
