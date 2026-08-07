import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
	decodeJupyterMessage,
	encodeJupyterMessage,
	type JupyterMessage,
} from "../src/tools/notebook-mode/jupyter-wire.ts";

test("Jupyter wire framing signs the four JSON frames and rejects tampering", () => {
	const message: JupyterMessage = {
		header: {
			msg_id: "message-1",
			session: "session-1",
			username: "pi-codex-conversion",
			date: "2026-01-01T00:00:00.000Z",
			msg_type: "kernel_info_request",
			version: "5.3",
		},
		parent_header: {},
		metadata: {},
		content: { probe: true },
	};
	const key = "wire-secret";
	const frames = encodeJupyterMessage(message, key);
	const expected = createHmac("sha256", key)
		.update(frames[2]!)
		.update(frames[3]!)
		.update(frames[4]!)
		.update(frames[5]!)
		.digest("hex");
	assert.equal(frames[1]!.toString(), expected);
	assert.deepEqual(decodeJupyterMessage(frames, key), message);

	const tampered = frames.map((frame) => Buffer.from(frame));
	const content = tampered[5]!;
	content[0] = content[0]! ^ 1;
	assert.equal(decodeJupyterMessage(tampered, key), undefined);
});
