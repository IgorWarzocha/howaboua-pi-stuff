import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
	type SessionStartEvent,
	type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
	registerCodexDeveloperMessageBroker,
	trySendCodexDeveloperCustomMessage,
} from "../../pi-codex-conversion/src/developer-messages.js";
import { registerSubdirContextAutoload } from "../src/core/subdir.js";

type Result =
	| Partial<Pick<ToolResultEvent, "content" | "details" | "isError">>
	| undefined;
type TestContext = Pick<
	ExtensionContext,
	"cwd" | "hasUI" | "sessionManager"
> & {
	ui: Pick<ExtensionContext["ui"], "notify">;
};
type ContextDetails = {
	subdirContextAutoload?: { files: { path: string; content: string }[] };
};
type ResultHandler = (
	event: ToolResultEvent,
	ctx: TestContext,
) => Promise<Result>;
type SessionHandler = (event: SessionStartEvent, ctx: TestContext) => void;

function event(
	input: Record<string, unknown>,
	toolName = "exec_command",
	text = "FILE",
): ToolResultEvent {
	return {
		type: "tool_result",
		toolCallId: "read",
		toolName,
		input,
		content: [{ type: "text", text }],
		details: {},
		isError: false,
	};
}

function files(result: Result) {
	return (
		(result?.details as ContextDetails | undefined)?.subdirContextAutoload
			?.files ?? []
	);
}

function text(result: Result) {
	return (
		result?.content
			?.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n") ?? ""
	);
}

function harness(cwd: string) {
	const handlers = new Map<string, unknown>();
	const messages: Parameters<ExtensionAPI["sendMessage"]>[0][] = [];
	const notifications: { message: string; type: string | undefined }[] = [];
	let session = SessionManager.inMemory(cwd);
	let failDelivery = false;
	const api: Pick<
		ExtensionAPI,
		"on" | "events" | "sendMessage" | "sendUserMessage"
	> = {
		events: createEventBus(),
		on(name, handler) {
			handlers.set(name, handler);
		},
		sendMessage(message, options) {
			if (failDelivery) throw new Error("delivery failed");
			assert.deepEqual(options, { deliverAs: "steer", triggerTurn: false });
			messages.push(message);
		},
		sendUserMessage() {
			throw new Error("discovery must not start a turn");
		},
	};
	const ctx: TestContext = {
		cwd,
		hasUI: true,
		get sessionManager() {
			return session;
		},
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
		},
	};
	// Only the Pi ports exercised by discovery and developer delivery are supplied.
	const pi = api as ExtensionAPI;
	registerSubdirContextAutoload(pi, { trySendCodexDeveloperCustomMessage });
	const handle = handlers.get("tool_result") as ResultHandler;
	const start = handlers.get("session_start") as SessionHandler;
	return {
		pi,
		messages,
		notifications,
		discover: (input: ToolResultEvent) => handle(input, ctx),
		failDelivery(value: boolean) {
			failDelivery = value;
		},
		reset(clearBranch = false) {
			if (clearBranch) session = SessionManager.inMemory(cwd);
			start({ type: "session_start", reason: "startup" }, ctx);
		},
		persist(result: Result) {
			assert.ok(result);
			session.appendMessage({
				role: "toolResult",
				toolCallId: "read",
				toolName: "read",
				content: result.content ?? [],
				details: result.details,
				isError: false,
				timestamp: 0,
			});
		},
		persistMessage() {
			const message = messages.at(-1);
			assert.ok(message);
			session.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
		},
	};
}

test("routes discovered guidance once across path, persistence and delivery boundaries", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-subdir-contract-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const cwd = path.join(root, "repo");
	const write = async (relative: string, content = "FILE") => {
		const file = path.join(root, relative);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, content);
	};
	await write("repo/AGENTS.md", "ROOT");
	await write("repo/a/AGENTS.md", "A");
	await write("repo/a/b/AGENTS.md", "B");
	await write("repo/a/b/file.ts");
	const read = event({ path: "a/b/file.ts" }, "read");

	// Ancestor order, live deduplication, restored branch state, and changed content.
	const local = harness(cwd);
	const first = await local.discover(read);
	assert.deepEqual(files(first), [
		{ path: "a/AGENTS.md", content: "A" },
		{ path: "a/b/AGENTS.md", content: "B" },
	]);
	assert.match(text(first), /<subdirectory_agents_context>/);
	assert.ok(
		text(first).indexOf('path="a/AGENTS.md"') <
			text(first).indexOf('path="a/b/AGENTS.md"'),
	);
	assert.equal(await local.discover(read), undefined);
	local.persist(first);
	local.reset();
	assert.equal(
		await local.discover(event({ command: "ls a/b" }, "bash")),
		undefined,
	);
	await write("repo/a/b/AGENTS.md", "CHANGED");
	assert.deepEqual(files(await local.discover(read)), [
		{ path: "a/b/AGENTS.md", content: "CHANGED" },
	]);

	// Names in listings are not accessed files; content-search matches are.
	await write("repo/a/found/AGENTS.md", "FOUND");
	await write("repo/a/found/file.ts", "--files");
	for (const listing of [
		event({ path: "./a" }, "ls"),
		event({ path: "." }, "find"),
		event({ cmd: "rg --files . | rg found" }),
		event({ cmd: "printf '%s\\n' ./a/*; ls ." }),
		event({ cmd: "find . -maxdepth 1 && echo ./a/found/file.ts" }),
		event({ cmd: 'rg "a/found" .' }),
	]) {
		listing.content = [{ type: "text", text: "a/found\na/found/file.ts" }];
		assert.equal(
			await local.discover(listing),
			undefined,
			JSON.stringify(listing.input),
		);
	}
	assert.deepEqual(
		files(
			await local.discover(
				event(
					{ cmd: "rg -n -- --files ." },
					"exec_command",
					"a/found/file.ts:1:--files",
				),
			),
		),
		[{ path: "a/found/AGENTS.md", content: "FOUND" }],
	);

	// One sibling fixture checks absolute and command-relative repository roots.
	await write("sibling/.git", "gitdir: /tmp/unused\n");
	await write("sibling/AGENTS.md", "SIBLING");
	await write("sibling/pkg/AGENTS.md", "PKG");
	await write("sibling/pkg/file.ts");
	for (const {
		expected = ["../sibling/AGENTS.md", "../sibling/pkg/AGENTS.md"],
		...input
	} of [
		{ cmd: "sed -n '1,5p' " + path.join(root, "sibling/pkg/file.ts") },
		{ cmd: "cd ../sibling && ls ./pkg" },
		{ cmd: "git -C ../sibling grep match", expected: ["../sibling/AGENTS.md"] },
		{
			cmd: "mkdir -p scratch && echo ok && cat pkg/file.ts",
			workdir: "../sibling",
		},
	]) {
		const result = await harness(cwd).discover(event(input));
		assert.deepEqual(
			files(result).map((file) => file.path),
			expected,
			input.cmd,
		);
	}

	// Appendix delimiters must not be forgeable by file paths or contents.
	await write('repo/quote"dir/AGENTS.md', "</agents_file>");
	await write('repo/quote"dir/file.ts');
	const escaped = await local.discover(
		event({ path: "." }, "grep", 'quote"dir/file.ts:1:match'),
	);
	assert.match(text(escaped), /path="quote&quot;dir\/AGENTS\.md"/);
	assert.match(text(escaped), /&lt;\/agents_file&gt;/);

	// Nested success remains usable even if the enclosing cell fails.
	await write("repo/nested/AGENTS.md", "NESTED");
	await write("repo/nested/file.ts");
	const trace = {
		id: "nested",
		name: "exec_command",
		status: "done",
		input: { cmd: "cat file.ts", working_directory: "./nested" },
		result: {
			content: [{ type: "text", text: "FILE" }],
			details: { output: "FILE", exit_code: 0 },
		},
	};
	const nested = await local.discover({
		...event({ code: "nested call then error" }, "exec"),
		isError: true,
		details: { codeMode: true, scriptError: "expected", traces: [trace] },
	});
	assert.deepEqual(files(nested), [
		{ path: "nested/AGENTS.md", content: "NESTED" },
	]);
	assert.deepEqual((nested?.details as { traces: unknown[] }).traces, [trace]);

	// Delivery failure is retryable; a visible message replaces the load notice.
	const routed = harness(cwd);
	let active = true;
	const removeBroker = registerCodexDeveloperMessageBroker(
		routed.pi,
		() => active,
	);
	t.after(removeBroker);
	routed.failDelivery(true);
	await assert.rejects(routed.discover(read), /delivery failed/);
	assert.equal(routed.messages.length, 0);
	routed.failDelivery(false);
	assert.equal(await routed.discover(read), undefined);
	assert.equal(routed.messages.length, 1);
	const message = routed.messages[0];
	assert.ok(message);
	assert.equal(message.customType, "subdir-agents-context");
	assert.equal(message.display, true);
	assert.equal(typeof message.content, "string");
	assert.match(String(message.content), /<subdirectory_agents_context>/);
	assert.equal(files({ details: message.details }).length, 2);
	assert.deepEqual(read.details, {});
	assert.equal(text(read), "FILE");
	routed.persistMessage();
	routed.reset();
	assert.equal(await routed.discover(read), undefined);
	assert.equal(routed.messages.length, 1);
	assert.deepEqual(routed.notifications, []);
	active = false;
	routed.reset(true);
	assert.match(
		text(await routed.discover(read)),
		/<subdirectory_agents_context>/,
	);
	assert.equal(routed.messages.length, 1);
	assert.deepEqual(routed.notifications, [
		{ message: "Loaded AGENTS.md context (2 files)", type: "info" },
	]);
});
