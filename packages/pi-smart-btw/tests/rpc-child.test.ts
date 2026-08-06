import { expect, test } from "bun:test";
import { reduceAssistantMessageUpdate } from "../src/rpc-child.js";

test("assembles Pi RPC deltas and accepts legacy cumulative snapshots", () => {
	const first = reduceAssistantMessageUpdate("", {
		assistantMessageEvent: { type: "text_delta", delta: "Hello" },
	});
	const second = reduceAssistantMessageUpdate(first ?? "", {
		assistantMessageEvent: { type: "text_delta", delta: " world" },
	});
	const legacy = reduceAssistantMessageUpdate(second ?? "", {
		assistantMessageEvent: {
			type: "text_delta",
			delta: " ignored",
			partial: {
				role: "assistant",
				content: [{ type: "text", text: "Authoritative snapshot" }],
			},
		},
	});

	expect({ first, second, legacy }).toEqual({
		first: "Hello",
		second: "Hello world",
		legacy: "Authoritative snapshot",
	});
});
