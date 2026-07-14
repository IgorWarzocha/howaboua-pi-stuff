import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexEvents } from "../src/extension/events.ts";

test("extension leaves skill discovery to Pi", () => {
	const events: string[] = [];
	const pi = {
		on(event: string) {
			events.push(event);
		},
	} as unknown as ExtensionAPI;
	const runtime = {
		sessions: { onSessionExit() {} },
		tracker: { recordSessionFinished() {} },
	};

	registerCodexEvents(pi, runtime as never, {} as never, {} as never, {} as never);

	assert.equal(events.includes("resources_discover"), false);
});
