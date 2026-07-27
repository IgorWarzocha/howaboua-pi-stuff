import { expect, test } from "bun:test";
import { parseReviewRpcFrame } from "../src/rpc-protocol.js";

test("accepts only actionable review RPC frames", () => {
	expect(parseReviewRpcFrame("not json")).toBeUndefined();
	expect(parseReviewRpcFrame('{"type":"response"}')).toBeUndefined();
	expect(
		parseReviewRpcFrame(
			'{"type":"message_end","message":{"role":"assistant","content":"wrong shape"}}',
		),
	).toBeUndefined();
	expect(
		parseReviewRpcFrame(
			'{"type":"message_end","message":{"role":"assistant","content":[null]}}',
		),
	).toBeUndefined();
	expect(
		parseReviewRpcFrame(
			'{"type":"response","id":"req_1","success":false,"error":"failed"}',
		),
	).toEqual({
		type: "response",
		id: "req_1",
		success: false,
		error: "failed",
	});
});
