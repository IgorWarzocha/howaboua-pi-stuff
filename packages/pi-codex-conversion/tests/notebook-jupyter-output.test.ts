import assert from "node:assert/strict";
import test from "node:test";
import { extractDenoSyntaxError } from "../src/tools/notebook-mode/deno-syntax-diagnostics.ts";
import { applyExecuteReplyError } from "../src/tools/notebook-mode/jupyter-output.ts";
import type { JupyterMessage } from "../src/tools/notebook-mode/jupyter-wire.ts";

test("execute_reply preserves failures omitted from IOPub", () => {
	const reply: JupyterMessage = {
		header: {
			msg_id: "reply-1",
			session: "session-1",
			username: "pi-codex-conversion",
			date: "2026-01-01T00:00:00.000Z",
			msg_type: "execute_reply",
			version: "5.3",
		},
		parent_header: {},
		metadata: {},
		content: {
			status: "error",
			ename: "Error",
			evalue: "Execution failed",
			traceback: [],
		},
	};

	assert.deepEqual(applyExecuteReplyError({ status: "ok", items: [] }, reply), {
		status: "error",
		items: [],
		errorName: "Error",
		errorValue: "Execution failed",
		errorText: "Error: Execution failed",
	});
	assert.equal(
		extractDenoSyntaxError("error: SyntaxError: Unexpected token `=`\n  |\n1 | const = 1;\n  |       ~\n    at file:///_stdin.ts:1:7\n"),
		"SyntaxError: Unexpected token `=`\n  |\n1 | const = 1;\n  |       ~\n    at notebook cell:1:7",
	);
	for (const path of ["file:///work/project/_stdin.ts", "file:///C:/work/project/_stdin.ts"]) {
		const diagnostic = `error: SyntaxError: Expression expected\n    at ${path}:4:1\n`;
		assert.equal(extractDenoSyntaxError(diagnostic), "SyntaxError: Expression expected\n    at notebook cell:4:1");
		assert.equal(
			extractDenoSyntaxError(diagnostic, "generated notebook code"),
			"SyntaxError: Expression expected\n    at generated notebook code:4:1",
		);
	}
	assert.equal(extractDenoSyntaxError("error: formatter unavailable"), undefined);
});
