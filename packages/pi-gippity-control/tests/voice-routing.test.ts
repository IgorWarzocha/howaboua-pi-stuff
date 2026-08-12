import { expect, test } from "bun:test";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";

test("late delegation survives completed acknowledgements", () => {
	const turns = new RealtimeVoiceTurnTracker();
	turns.inputAdded("handle this next");
	expect(turns.userFinished("Handle this next")).toBeUndefined();
	turns.outputAdded("On it");
	expect(turns.assistantFinished("On it")).toEqual({ input: "On it" });
	expect(turns.assistantFinished("Still on it")).toEqual({
		input: "Still on it",
	});
	expect(turns.delegated("Handle this next", "delegation-3")).toEqual({
		input: "Handle this next",
		delegationId: "delegation-3",
	});
});
