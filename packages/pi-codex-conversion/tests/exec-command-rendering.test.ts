import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExecCommandTracker } from "../src/tools/exec/command-state.ts";
import { registerExecCommandTool } from "../src/tools/exec/command-tool.ts";

function createTheme() {
	return {
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function renderComponentText(component: { render(width: number): string[] } | undefined): string {
	assert.ok(component);
	return stripAnsi(component.render(80).map((line) => line.trimEnd()).join("\n").trim());
}

function createRegisteredExecTool(options: { showOutputWhenCollapsed?: boolean } = {}) {
	let tool:
		| {
				renderResult?: (
					result: { content: Array<{ type: string; text?: string }>; details?: unknown },
					options: { expanded: boolean; isPartial: boolean },
					theme: ReturnType<typeof createTheme>,
					context?: { toolCallId?: string; args?: { cmd?: string } },
				) => { render(width: number): string[] };
		  }
		| undefined;
	const pi = {
		registerTool(definition: typeof tool) {
			tool = definition;
		},
	} as unknown as ExtensionAPI;
	registerExecCommandTool(pi, createExecCommandTracker(), {} as never, options);
	assert.ok(tool);
	return tool;
}

test("exec_command can show shell output when global tool expansion is collapsed", () => {
	const tool = createRegisteredExecTool({ showOutputWhenCollapsed: true });
	const rendered = renderComponentText(
		tool.renderResult?.(
			{
				content: [{ type: "text", text: "" }],
				details: {
					chunk_id: "chunk",
					wall_time_seconds: 0.82,
					exit_code: 0,
					output: "one\ntwo\nthree\nfour\nfive\nsix\nseven\n",
				},
			},
			{ expanded: false, isPartial: false },
			createTheme(),
			{ toolCallId: "call", args: { cmd: "printf" } },
		),
	);

	assert.match(rendered, /^\.\.\. \(3 earlier lines, .*to expand\)/);
	assert.match(rendered, /four/);
	assert.match(rendered, /seven/);
	assert.match(rendered, /Took 0\.8s/);
});

test("exec_command hides shell output when collapsed preview is off", () => {
	const tool = createRegisteredExecTool({ showOutputWhenCollapsed: false });
	const rendered = renderComponentText(
		tool.renderResult?.(
			{
				content: [{ type: "text", text: "" }],
				details: { chunk_id: "chunk", wall_time_seconds: 0.1, exit_code: 0, output: "alpha\n" },
			},
			{ expanded: false, isPartial: false },
			createTheme(),
			{ toolCallId: "call", args: { cmd: "printf" } },
		),
	);

	assert.equal(rendered, "");
});

test("exec_command shows PATH apply_patch preview while collapsed without changing model output", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-apply-patch-preview-"));
	writeFileSync(join(cwd, "notes.md"), "old\n", "utf8");
	const command = `apply_patch <<'PATCH'
*** Begin Patch
*** Update File: notes.md
@@
-old
+new
*** End Patch
PATCH`;
	let tool:
		| {
				execute?: (...args: any[]) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
				renderResult?: (
					result: { content: Array<{ type: string; text?: string }>; details?: unknown },
					options: { expanded: boolean; isPartial: boolean },
					theme: ReturnType<typeof createTheme>,
					context?: { toolCallId?: string; args?: { cmd?: string } },
				) => { render(width: number): string[] };
		  }
		| undefined;
	const sessions = {
		async exec() {
			return { chunk_id: "chunk", wall_time_seconds: 0.1, exit_code: 0, output: "Success. Updated the following files:\nM notes.md\n" };
		},
	} as never;
	const pi = { registerTool(definition: typeof tool) { tool = definition; } } as unknown as ExtensionAPI;
	registerExecCommandTool(pi, createExecCommandTracker(), sessions, { showOutputWhenCollapsed: false });

	try {
		assert.ok(tool?.execute);
		const result = await tool.execute("path-patch-call", { cmd: command }, undefined, undefined, { cwd, model: {} });
		const modelText = result.content[0]?.type === "text" ? result.content[0].text : "";
		const rendered = renderComponentText(
			tool.renderResult?.(result, { expanded: false, isPartial: false }, createTheme(), {
				toolCallId: "path-patch-call",
				args: { cmd: command },
			}),
		);

		assert.doesNotMatch(modelText ?? "", /Begin Patch/);
		assert.match(rendered, /^• Edited notes\.md \(\+1 -1\)/);
		assert.match(rendered, /-old/);
		assert.match(rendered, /\+new/);
		assert.doesNotMatch(rendered, /Success\. Updated/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
