import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertPathToolExecResult, getPathToolPolicy } from "../src/tools/path/outputs.ts";
import { registerExecCommandTool } from "../src/tools/exec/command-tool.ts";
import { createExecCommandTracker } from "../src/tools/exec/command-state.ts";
import { createExecSessionManager } from "../src/tools/exec/session-manager.ts";

const theme = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
};

test("PATH apply_patch results omit heredoc command while preserving output", () => {
	const command = `apply_patch <<'PATCH'
*** Begin Patch
*** Update File: notes.md
@@
-old
+new
*** End Patch
PATCH
sed -n '1,20p' notes.md`;
	const policy = getPathToolPolicy(command, undefined);
	const converted = convertPathToolExecResult(command, {
		chunk_id: "abc123",
		wall_time_seconds: 0.01,
		exit_code: 0,
		original_token_count: 42,
		output: "Success. Updated the following files:\nM notes.md\nnew\n",
	}, policy);

	assert.ok(converted);
	const text = converted.content[0]?.type === "text" ? converted.content[0].text : "";
	assert.doesNotMatch(text, /Command:/);
	assert.doesNotMatch(text, /Begin Patch/);
	assert.doesNotMatch(text, /Original token count/);
	assert.doesNotMatch(text, /Wall time/);
	assert.match(text, /Success\. Updated the following files/);
	assert.match(text, /new/);
});

test("PATH apply_patch failure keeps error output but omits patch command", () => {
	const command = `apply_patch <<'PATCH'
*** Begin Patch
*** Update File: missing.md
@@
-old
+new
*** End Patch
PATCH`;
	const policy = getPathToolPolicy(command, undefined);
	const converted = convertPathToolExecResult(command, {
		chunk_id: "abc123",
		wall_time_seconds: 0.01,
		exit_code: 1,
		output: "Failed to read file to update missing.md\n",
	}, policy);

	assert.ok(converted);
	const text = converted.content[0]?.type === "text" ? converted.content[0].text : "";
	assert.doesNotMatch(text, /Command:/);
	assert.doesNotMatch(text, /Begin Patch/);
	assert.match(text, /Process exited with code 1/);
	assert.match(text, /Failed to read file to update missing\.md/);
});

test("PATH apply_patch call rendering expands with tool output expansion", () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-apply-patch-render-"));
	const addedLines = Array.from({ length: 20 }, (_, index) => `+line ${String(index + 1).padStart(2, "0")}`).join("\n");
	const command = `apply_patch <<'PATCH'
*** Begin Patch
*** Add File: long.txt
${addedLines}
*** End Patch
PATCH`;
	const sessions = createExecSessionManager();
	try {
		let tool: any;
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions);

		const collapsed = tool.renderCall({ cmd: command }, theme, { toolCallId: "call-1", cwd, expanded: false }).render(200).join("\n");
		const expanded = tool.renderCall({ cmd: command }, theme, { toolCallId: "call-1", cwd, expanded: true }).render(200).join("\n");

		assert.match(collapsed, /more lines/);
		assert.doesNotMatch(collapsed, /line 20/);
		assert.doesNotMatch(expanded, /more lines/);
		assert.match(expanded, /line 20/);
	} finally {
		sessions.shutdown();
	}
});

test("PATH apply_patch compact tools rendering hides collapsed diff preview", () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-apply-patch-compact-render-"));
	const addedLines = Array.from({ length: 20 }, (_, index) => `+line ${String(index + 1).padStart(2, "0")}`).join("\n");
	const command = `apply_patch <<'PATCH'
*** Begin Patch
*** Add File: long.txt
${addedLines}
*** End Patch
PATCH`;
	const sessions = createExecSessionManager();
	try {
		let tool: any;
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions, { compactTools: true });

		const collapsed = tool.renderCall({ cmd: command }, theme, { toolCallId: "call-compact", cwd, expanded: false }).render(200).join("\n");
		const expanded = tool.renderCall({ cmd: command }, theme, { toolCallId: "call-compact", cwd, expanded: true }).render(200).join("\n");

		assert.match(collapsed, /Added long\.txt \(\+20 -0\)/);
		assert.doesNotMatch(collapsed, /line 01/);
		assert.doesNotMatch(collapsed, /more lines/);
		assert.match(expanded, /line 20/);
	} finally {
		sessions.shutdown();
	}
});
