import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import {
	prepareCodexSystemPrompt,
	type PiSystemPromptOptions,
} from "../src/prompt/build-system-prompt.ts";
import { prepareCodeModeToolsPrompt } from "../src/tools/code-mode/custom-tool-prompt.ts";
import { NotebookCell } from "../src/tools/notebook-mode/cell.ts";
import { createNotebookControlProxy } from "../src/tools/code-mode/notebook-tool.ts";
import { SharedCodeModeRuntime } from "../src/tools/code-mode/shared-runtime.ts";
import type { NotebookControlRequest, ToolExecutionContext } from "../src/tools/code-mode/types.ts";

test("Notebook exec preserves prompt integration and control routing", async () => {
	const calls: Array<{
		request: NotebookControlRequest;
		context: ToolExecutionContext;
		signal: AbortSignal | undefined;
	}> = [];
	const runtime = {
		async controlNotebook(request, context, signal) {
			calls.push({ request, context, signal });
			return { message: `Ran ${request.action}`, details: { action: request.action } };
		},
	} as Pick<SharedCodeModeRuntime, "controlNotebook"> as SharedCodeModeRuntime;
	const proxy = createNotebookControlProxy(runtime);
	const context: ToolExecutionContext = { cwd: "/project", toolCallId: "nested-notebook" };
	const controller = new AbortController();
	const modes = new SharedCodeModeRuntime();
	modes.addProvider({
		getTools: () => [],
		executionKind: (mode) => mode as "code" | "notebook",
	});
	const promptTool = { ...proxy, deferLoading: false };
	const promptOptions: PiSystemPromptOptions = {
		selectedTools: ["exec", "wait", "notebook"],
		toolSnippets: {},
		toolGuidelines: { exec: ["Keep extension tool guidance"] },
		promptGuidelines: ["Keep extension prompt guidance"],
		appendSystemPrompt: "Keep configured addendum",
		sections: { extension_context: "Keep extension section" },
		cwd: "/project",
		contextFiles: [{ path: "/project/AGENTS.md", content: "Keep project context" }],
		skills: [],
	};
	prepareCodeModeToolsPrompt(
		promptOptions,
		[promptTool],
		undefined,
		() => ["exec", "wait", "notebook"].every((name) => promptOptions.selectedTools.includes(name)),
	);
	prepareCodexSystemPrompt(promptOptions, {
		mode: "notebook",
		shell: "/usr/bin/zsh",
		skills: [{ name: "review", description: "Review code", filePath: "/skills/review/SKILL.md" }],
	});
	assert.match(promptOptions.sections!["codex_tools"]!, /notebook/);
	assert.match(promptOptions.sections!["codex_skills"]!, /review: Review code/);
	assert.equal(promptOptions.sections!["codex_runtime"], "Current shell: /usr/bin/zsh; follow its syntax, quoting, and variable rules; capture $? as rc");
	assert.equal(promptOptions.sections!["extension_context"], "Keep extension section");
	assert.equal(promptOptions.appendSystemPrompt, "Keep configured addendum");
	assert.deepEqual(promptOptions.contextFiles, [{ path: "/project/AGENTS.md", content: "Keep project context" }]);
	assert.ok(promptOptions.promptGuidelines!.includes("Keep extension prompt guidance"));
	const notebookTools = promptOptions.selectedTools;
	promptOptions.selectedTools = ["read"];
	assert.equal(promptOptions.sections!["codex_tools"], "");
	assert.equal(promptOptions.sections!["codex_skills"], "");
	assert.doesNotMatch(promptOptions.sections!["codex_guidelines"]!, /tools\.exec_command/);
	promptOptions.selectedTools = notebookTools;

	const forcedOptions: PiSystemPromptOptions = {
		...promptOptions,
		sections: {},
		forceSystemPrompt: "Forced by an earlier extension",
	};
	for (let attempt = 0; attempt < 2; attempt += 1) {
		prepareCodeModeToolsPrompt(forcedOptions, [promptTool]);
		prepareCodexSystemPrompt(forcedOptions, { mode: "notebook", shell: "/bin/bash" });
	}
	assert.match(forcedOptions.forceSystemPrompt!, /^Forced by an earlier extension/);
	assert.match(forcedOptions.forceSystemPrompt!, /<codex_tools>/);
	assert.match(forcedOptions.forceSystemPrompt!, /<codex_runtime>/);
	assert.equal(forcedOptions.forceSystemPrompt!.match(/<codex_guidelines>/g)?.length, 1);

	const heavyOptions: PiSystemPromptOptions = {
		...promptOptions,
		selectedTools: ["bash"],
		toolGuidelines: { bash: ["Keep extension tool guidance"] },
		sections: { extension_context: "Keep extension section" },
		promptGuidelines: ["Be concise in your responses", "Keep extension prompt guidance"],
	};
	for (let attempt = 0; attempt < 2; attempt += 1) {
		prepareCodexSystemPrompt(heavyOptions, {
			mode: "normal",
			heavySystemPromptOverwrite: true,
			skills: [{ name: "review", description: "Review code", filePath: "/skills/review/SKILL.md" }],
		});
	}
	assert.doesNotMatch(heavyOptions.customPrompt!, /Be concise in your responses/);
	assert.match(heavyOptions.sections!["codex_guidelines"]!, /Keep extension tool guidance/);
	assert.match(heavyOptions.sections!["codex_guidelines"]!, /Keep extension prompt guidance/);
	assert.match(heavyOptions.sections!["skills"]!, /review: Review code/);
	assert.equal(heavyOptions.sections!["extension_context"], "Keep extension section");
	assert.deepEqual(modes.collectTools("code"), []);
	assert.equal(modes.collectTools("notebook").at(-1)?.name, "notebook");

	assert.deepEqual(
		await proxy.invoke({ action: "list", query: "saved*" }, context, controller.signal),
		{ message: "Ran list", details: { action: "list" } },
	);
	assert.deepEqual(calls, [{
		request: { action: "list", query: "saved*" },
		context,
		signal: controller.signal,
	}]);

	const retry = { action: "pin" as const, names: ["alpha"], hook: "tool_result" as const };
	assert.deepEqual(
		await proxy.invoke({ ...retry, names: ["alpha", "alpha"] }, context, controller.signal),
		{
			message: `Notebook pin was not run because it needs the active exec cell to finish. After exec returns, call notebook with ${JSON.stringify(retry)}.`,
			details: { notRun: true, action: "pin", retry },
		},
	);
	assert.equal(calls.length, 1);

	const cell = new NotebookCell({
		id: "blocked-cell",
		source: "",
		context: { cwd: process.cwd() },
		maxOutputTokens: 1,
	});
	const observationController = new AbortController();
	cell.setBlocked("tool", true);
	const observation = cell.observe(0, observationController.signal);
	await Promise.resolve();
	cell.setBlocked("tool", false);
	await observation;
	assert.equal(getEventListeners(observationController.signal, "abort").length, 0);
});
