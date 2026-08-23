import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import extension from "../dist/index.js";

const DETAILS_KEY = "subdirContextAutoload";

function mockPi() {
	const handlers = new Map();
	const sentMessages = [];
	return {
		handlers,
		sentMessages,
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerTool() {},
		registerCommand() {},
		sendUserMessage() {},
		sendMessage(message) {
			sentMessages.push(message);
		},
	};
}

function persistedFiles(details) {
	const value = details?.[DETAILS_KEY]?.files;
	return Array.isArray(value) ? value : [];
}

function textContent(result) {
	return (
		result.content
			?.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n") ?? ""
	);
}

function toolEvent(overrides) {
	return {
		toolName: "exec_command",
		isError: false,
		input: {},
		content: [{ type: "text", text: "ok" }],
		details: {},
		...overrides,
	};
}

async function run() {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "pi-workflows-tool-test-"),
	);
	const cwd = path.join(root, "repo");
	await fs.mkdir(path.join(cwd, "a", "b", "c"), { recursive: true });
	await fs.writeFile(path.join(cwd, "AGENTS.md"), "ROOT");
	await fs.writeFile(path.join(cwd, "a", "AGENTS.md"), "A");
	await fs.writeFile(path.join(cwd, "a", "b", "AGENTS.md"), "B");
	await fs.writeFile(
		path.join(cwd, "a", "b", "c", "file.ts"),
		"export const x = 1;\n",
	);

	const branchEntries = [];
	const pi = mockPi();
	extension(pi);

	const ctx = {
		cwd,
		hasUI: false,
		sessionManager: {
			getBranch() {
				return branchEntries;
			},
		},
	};

	const sessionStart = pi.handlers.get("session_start");
	const toolResult = pi.handlers.get("tool_result");
	const contextHook = pi.handlers.get("context");
	assert.ok(sessionStart, "session_start handler must exist");
	assert.ok(toolResult, "tool_result handler must exist");
	assert.equal(
		contextHook,
		undefined,
		"subdirectory AGENTS context must not be injected into model context",
	);

	sessionStart({}, ctx);

	const readEvent = {
		toolName: "read",
		isError: false,
		input: { path: path.join(cwd, "a", "b", "c", "file.ts") },
		content: [{ type: "text", text: "FILE" }],
		details: {},
	};

	const firstRead = await toolResult(readEvent, ctx);
	assert.ok(
		firstRead,
		"first read should persist discovered AGENTS context in details",
	);
	assert.match(textContent(firstRead), /<subdirectory_agents_context>/);
	assert.match(textContent(firstRead), /<agents_file path="a\/AGENTS\.md">/);
	assert.match(textContent(firstRead), /<agents_file path="a\/b\/AGENTS\.md">/);
	assert.equal(
		persistedFiles(firstRead.details).length,
		2,
		"should persist two nested AGENTS files",
	);

	branchEntries.push({
		type: "message",
		message: { role: "toolResult", details: firstRead.details },
	});

	branchEntries.length = 0;
	branchEntries.push({
		type: "message",
		message: { role: "toolResult", details: firstRead.details },
	});
	sessionStart({}, ctx);

	const secondRead = await toolResult(readEvent, ctx);
	assert.equal(
		secondRead,
		undefined,
		"second read should not emit duplicate unchanged AGENTS context",
	);

	for (let index = 0; index < 8; index += 1) {
		await toolResult(
			{
				toolName: "bash",
				isError: false,
				input: { command: "ls ." },
				content: [{ type: "text", text: "listing" }],
				details: {},
			},
			ctx,
		);
	}

	const tenthQualifyingAction = await toolResult(
		{
			toolName: "bash",
			isError: false,
			input: { command: "ls ./a/b/c" },
			content: [{ type: "text", text: "listing" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		tenthQualifyingAction,
		"cadence refresh should re-append unchanged AGENTS context on the tenth qualifying operation",
	);
	assert.equal(
		persistedFiles(tenthQualifyingAction.details).length,
		0,
		"cadence refresh should not persist duplicate unchanged AGENTS context",
	);
	assert.match(
		textContent(tenthQualifyingAction),
		/<agents_file path="a\/AGENTS\.md">/,
	);

	await fs.writeFile(path.join(cwd, "a", "b", "c", "AGENTS.md"), "C");

	const freshNestedViaBash = await toolResult(
		{
			toolName: "bash",
			isError: false,
			input: { command: "ls ./a/b/c" },
			content: [{ type: "text", text: "listing" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		freshNestedViaBash,
		"fresh nested AGENTS should persist update details",
	);
	assert.equal(persistedFiles(freshNestedViaBash.details).length, 1);
	assert.equal(
		persistedFiles(freshNestedViaBash.details)[0].path,
		"a/b/c/AGENTS.md",
	);
	assert.match(
		textContent(freshNestedViaBash),
		/<agents_file path="a\/b\/c\/AGENTS\.md">/,
	);

	await fs.mkdir(path.join(cwd, "a", "d"), { recursive: true });
	await fs.writeFile(path.join(cwd, "a", "d", "AGENTS.md"), "D");

	const freshNestedViaExecCommand = await toolResult(
		{
			toolName: "exec_command",
			isError: false,
			input: { cmd: "ls ./a/d" },
			content: [{ type: "text", text: "listing" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		freshNestedViaExecCommand,
		"exec_command with cmd should persist nested AGENTS updates",
	);
	assert.equal(persistedFiles(freshNestedViaExecCommand.details).length, 1);
	assert.equal(
		persistedFiles(freshNestedViaExecCommand.details)[0].path,
		"a/d/AGENTS.md",
	);

	await fs.mkdir(path.join(cwd, "a", "e"), { recursive: true });
	await fs.writeFile(path.join(cwd, "a", "e", "AGENTS.md"), "E");
	await fs.writeFile(
		path.join(cwd, "a", "e", "file.ts"),
		"export const e = 1;\n",
	);

	const freshNestedViaCat = await toolResult(
		{
			toolName: "exec_command",
			isError: false,
			input: { cmd: "cat ./a/e/file.ts" },
			content: [{ type: "text", text: "file" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		freshNestedViaCat,
		"cat through exec_command should persist nested AGENTS updates",
	);
	assert.equal(persistedFiles(freshNestedViaCat.details).length, 1);
	assert.equal(
		persistedFiles(freshNestedViaCat.details)[0].path,
		"a/e/AGENTS.md",
	);

	await fs.mkdir(path.join(cwd, "a", "f"), { recursive: true });
	await fs.writeFile(path.join(cwd, "a", "f", "AGENTS.md"), "F");
	await fs.writeFile(
		path.join(cwd, "a", "f", "file.ts"),
		"export const f = 1;\n",
	);

	const freshNestedViaSed = await toolResult(
		{
			toolName: "exec_command",
			isError: false,
			input: { cmd: "sed -n '1,5p' ./a/f/file.ts" },
			content: [{ type: "text", text: "file" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		freshNestedViaSed,
		"sed through exec_command should persist nested AGENTS updates",
	);
	assert.equal(persistedFiles(freshNestedViaSed.details).length, 1);
	assert.equal(
		persistedFiles(freshNestedViaSed.details)[0].path,
		"a/f/AGENTS.md",
	);

	await fs.mkdir(path.join(cwd, "a", "chained"), { recursive: true });
	await fs.writeFile(path.join(cwd, "a", "chained", "AGENTS.md"), "CHAINED");
	await fs.writeFile(
		path.join(cwd, "a", "chained", "file.ts"),
		"export const chained = 1;\n",
	);

	const freshNestedViaChainedCommand = await toolResult(
		{
			toolName: "exec_command",
			isError: false,
			input: {
				cmd: "mkdir -p ./scratch && echo ok && sed -n '1,5p' ./a/chained/file.ts",
			},
			content: [{ type: "text", text: "file" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		freshNestedViaChainedCommand,
		"chained exec_command should inspect later read commands",
	);
	assert.equal(persistedFiles(freshNestedViaChainedCommand.details).length, 1);
	assert.equal(
		persistedFiles(freshNestedViaChainedCommand.details)[0].path,
		"a/chained/AGENTS.md",
	);

	await fs.mkdir(path.join(cwd, "a", "g"), { recursive: true });
	await fs.writeFile(path.join(cwd, "a", "g", "AGENTS.md"), "G");

	const freshNestedViaLsTool = await toolResult(
		{
			toolName: "ls",
			isError: false,
			input: { path: "./a/g" },
			content: [{ type: "text", text: "listing" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		freshNestedViaLsTool,
		"ls tool should persist nested AGENTS updates",
	);
	assert.equal(persistedFiles(freshNestedViaLsTool.details).length, 1);
	assert.equal(
		persistedFiles(freshNestedViaLsTool.details)[0].path,
		"a/g/AGENTS.md",
	);

	branchEntries.push({
		type: "message",
		message: { role: "toolResult", details: freshNestedViaBash.details },
	});

	const sibling = path.join(root, "sibling");
	await fs.mkdir(path.join(sibling, "pkg", "src"), { recursive: true });
	await fs.writeFile(path.join(sibling, ".git"), "gitdir: /tmp/nowhere\n");
	await fs.writeFile(path.join(sibling, "AGENTS.md"), "SIBLING ROOT");
	await fs.writeFile(path.join(sibling, "pkg", "AGENTS.md"), "SIBLING PKG");
	await fs.writeFile(
		path.join(sibling, "pkg", "src", "file.ts"),
		"export const sibling = 1;\n",
	);

	const siblingRead = await toolResult(
		{
			toolName: "exec_command",
			isError: false,
			input: {
				cmd: `sed -n '1,5p' ${path.join(sibling, "pkg", "src", "file.ts")}`,
			},
			content: [{ type: "text", text: "file" }],
			details: {},
		},
		ctx,
	);

	assert.ok(
		siblingRead,
		"absolute sibling repo access should append sibling AGENTS",
	);
	assert.match(
		textContent(siblingRead),
		/<agents_file path="\.\.\/sibling\/AGENTS\.md">/,
	);
	assert.match(
		textContent(siblingRead),
		/<agents_file path="\.\.\/sibling\/pkg\/AGENTS\.md">/,
	);

	const parallelLikeDuplicate = await toolResult(readEvent, ctx);
	assert.equal(
		parallelLikeDuplicate,
		undefined,
		"runtime state should dedupe repeated reads even when branch state is stale",
	);

	await fs.mkdir(path.join(cwd, "a", "found", "leaf"), { recursive: true });
	await fs.writeFile(path.join(cwd, "a", "found", "AGENTS.md"), "FOUND");
	await fs.writeFile(
		path.join(cwd, "a", "found", "leaf", "file.ts"),
		"export const found = 1;\n",
	);
	const findResult = await toolResult(
		toolEvent({
			toolName: "find",
			input: { path: "." },
			content: [{ type: "text", text: "a/found/leaf/file.ts" }],
		}),
		ctx,
	);
	assert.ok(findResult, "find result paths should load nested AGENTS");
	assert.match(
		textContent(findResult),
		/<agents_file path="a\/found\/AGENTS\.md">/,
	);

	await fs.mkdir(path.join(cwd, "a", "shell-found", "leaf"), {
		recursive: true,
	});
	await fs.writeFile(
		path.join(cwd, "a", "shell-found", "AGENTS.md"),
		"SHELL FOUND",
	);
	await fs.writeFile(
		path.join(cwd, "a", "shell-found", "leaf", "file.ts"),
		"export const shellFound = 1;\n",
	);
	const shellFindResult = await toolResult(
		toolEvent({
			input: { cmd: "find . -name file.ts" },
			content: [{ type: "text", text: "a/shell-found/leaf/file.ts" }],
		}),
		ctx,
	);
	assert.ok(
		shellFindResult,
		"shell discovery output paths should load nested AGENTS",
	);
	assert.match(
		textContent(shellFindResult),
		/<agents_file path="a\/shell-found\/AGENTS\.md">/,
	);

	await fs.mkdir(path.join(cwd, "a", "separated"), { recursive: true });
	await fs.writeFile(
		path.join(cwd, "a", "separated", "AGENTS.md"),
		"SEPARATED",
	);
	await fs.writeFile(
		path.join(cwd, "a", "separated", "file.ts"),
		"export const separated = 1;\n",
	);
	const separatedNonDiscovery = await toolResult(
		toolEvent({
			input: { cmd: "find . -maxdepth 1 && echo ./a/separated/file.ts" },
			content: [{ type: "text", text: "ok" }],
		}),
		ctx,
	);
	assert.equal(
		separatedNonDiscovery,
		undefined,
		"&& should stop discovery argument scanning for later non-discovery commands",
	);

	const cdSibling = path.join(root, "sibling-cd");
	await fs.mkdir(path.join(cdSibling, "pkg", "src"), { recursive: true });
	await fs.writeFile(path.join(cdSibling, ".git"), "gitdir: /tmp/nowhere\n");
	await fs.writeFile(path.join(cdSibling, "AGENTS.md"), "SIBLING CD ROOT");

	const cdRepoRead = await toolResult(
		toolEvent({
			input: { cmd: `cd ${cdSibling} && ls ./pkg/src` },
			content: [{ type: "text", text: "listing" }],
		}),
		ctx,
	);
	assert.ok(
		cdRepoRead,
		"shell target extraction should track cd before discovery commands",
	);
	assert.match(
		textContent(cdRepoRead),
		/<agents_file path="\.\.\/sibling-cd\/AGENTS\.md">/,
	);

	const gitRepo = path.join(root, "git-target");
	await fs.mkdir(gitRepo, { recursive: true });
	await fs.writeFile(path.join(gitRepo, ".git"), "gitdir: /tmp/nowhere\n");
	await fs.writeFile(path.join(gitRepo, "AGENTS.md"), "GIT TARGET");

	const gitCRead = await toolResult(
		toolEvent({
			input: { cmd: `git -C ${gitRepo} grep sibling` },
			content: [{ type: "text", text: "match" }],
		}),
		ctx,
	);
	assert.ok(
		gitCRead,
		"git -C discovery commands should load the target repo AGENTS",
	);
	assert.match(
		textContent(gitCRead),
		/<agents_file path="\.\.\/git-target\/AGENTS\.md">/,
	);

	const patternOnly = await toolResult(
		toolEvent({
			input: { cmd: 'rg "a/found" .' },
			content: [{ type: "text", text: "listing" }],
		}),
		ctx,
	);
	assert.equal(
		patternOnly,
		undefined,
		"path-like rg patterns should not be treated as accessed paths when they do not exist",
	);

	await fs.mkdir(path.join(cwd, 'quote"dir'), { recursive: true });
	await fs.writeFile(
		path.join(cwd, 'quote"dir', "AGENTS.md"),
		"</agents_file>",
	);
	await fs.writeFile(
		path.join(cwd, 'quote"dir', "file.ts"),
		"export const quoted = 1;\n",
	);
	const escapedAppendix = await toolResult(
		toolEvent({
			toolName: "find",
			input: { path: "." },
			content: [{ type: "text", text: 'quote"dir/file.ts' }],
		}),
		ctx,
	);
	assert.ok(
		escapedAppendix,
		"appendix should include escaped AGENTS path/content",
	);
	assert.match(
		textContent(escapedAppendix),
		/path="quote&quot;dir\/AGENTS\.md"/,
	);
	assert.match(textContent(escapedAppendix), /&lt;\/agents_file&gt;/);

	await fs.mkdir(path.join(cwd, "a", "code-mode"), { recursive: true });
	await fs.writeFile(
		path.join(cwd, "a", "code-mode", "AGENTS.md"),
		"CODE MODE",
	);
	await fs.writeFile(
		path.join(cwd, "a", "code-mode", "file.ts"),
		"export const codeMode = 1;\n",
	);

	const codeModeTrace = {
		id: "nested-exec-command",
		name: "exec_command",
		status: "done",
		input: {
			cmd: "sed -n '1,5p' file.ts",
			workdir: "./a/code-mode",
		},
		result: {
			content: [{ type: "text", text: "export const codeMode = 1;" }],
			details: { output: "export const codeMode = 1;", exit_code: 0 },
		},
	};
	const freshNestedViaCodeMode = await toolResult(
		{
			toolName: "exec",
			isError: false,
			input: { code: "await tools.exec_command(...)" },
			content: [{ type: "text", text: "Script completed" }],
			details: { codeMode: true, traces: [codeModeTrace] },
		},
		ctx,
	);

	assert.ok(
		freshNestedViaCodeMode,
		"Code Mode exec_command traces should persist nested AGENTS updates",
	);
	assert.equal(persistedFiles(freshNestedViaCodeMode.details).length, 1);
	assert.equal(
		persistedFiles(freshNestedViaCodeMode.details)[0].path,
		"a/code-mode/AGENTS.md",
	);
	assert.deepEqual(
		freshNestedViaCodeMode.details.traces,
		[codeModeTrace],
		"persisted context should preserve Code Mode trace details",
	);
	assert.match(
		textContent(freshNestedViaCodeMode),
		/<agents_file path="a\/code-mode\/AGENTS\.md">/,
	);

	await fs.mkdir(path.join(cwd, "a", "code-mode-error"), {
		recursive: true,
	});
	await fs.writeFile(
		path.join(cwd, "a", "code-mode-error", "AGENTS.md"),
		"CODE MODE ERROR",
	);
	await fs.writeFile(
		path.join(cwd, "a", "code-mode-error", "file.ts"),
		"export const beforeError = true;\n",
	);

	const codeModeScriptError = await toolResult(
		{
			toolName: "exec",
			isError: true,
			input: { code: "await tools.exec_command(...); throw new Error(...)" },
			content: [{ type: "text", text: "Script error: expected" }],
			details: {
				codeMode: true,
				scriptError: "expected",
				traces: [
					{
						...codeModeTrace,
						id: "nested-before-script-error",
						input: {
							cmd: "cat file.ts",
							working_directory: "./a/code-mode-error",
						},
					},
				],
			},
		},
		ctx,
	);

	assert.ok(
		codeModeScriptError,
		"successful nested traces should load AGENTS after a Code Mode script error",
	);
	assert.equal(persistedFiles(codeModeScriptError.details).length, 1);
	assert.equal(
		persistedFiles(codeModeScriptError.details)[0].path,
		"a/code-mode-error/AGENTS.md",
	);
	assert.match(
		textContent(codeModeScriptError),
		/<agents_file path="a\/code-mode-error\/AGENTS\.md">/,
	);

	await fs.rm(root, { recursive: true, force: true });
	console.log("subdir-context test passed");
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
