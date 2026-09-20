import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { JsonValue } from "@earendil-works/pi-ai";
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
	toolName = "read",
	resultText = "FILE",
): ToolResultEvent {
	return {
		type: "tool_result",
		toolCallId: "read",
		toolName,
		input,
		content: [{ type: "text", text: resultText }],
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
	let session = SessionManager.inMemory(cwd);
	let failDelivery = false;
	const api: Pick<
		ExtensionAPI,
		"on" | "events" | "sendMessage" | "sendUserMessage"
	> = {
		events: createEventBus(),
		on(name, handler) {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
		sendMessage(message) {
			if (failDelivery) throw new Error("delivery failed");
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
		ui: { notify() {} },
	};
	const pi = api as ExtensionAPI;
	registerSubdirContextAutoload(pi, { trySendCodexDeveloperCustomMessage });
	const handle = handlers.get("tool_result") as ResultHandler;
	const start = handlers.get("session_start") as SessionHandler;
	return {
		pi,
		messages,
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
			const details: JsonValue | undefined =
				result.details === undefined
					? undefined
					: JSON.parse(JSON.stringify(result.details));
			session.appendMessage({
				role: "toolResult",
				toolCallId: "read",
				toolName: "read",
				content: result.content ?? [],
				...(details !== undefined ? { details } : {}),
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

test("routes discovered guidance once across persistence and delivery boundaries", async (t) => {
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
	await write('repo/a/quote"dir/AGENTS.md', "</agents_file>");
	await write('repo/a/quote"dir/file.ts');
	const read = event({ path: 'a/quote"dir/file.ts' });

	const local = harness(cwd);
	const first = await local.discover(read);
	assert.deepEqual(files(first), [
		{ path: "a/AGENTS.md", content: "A" },
		{ path: 'a/quote"dir/AGENTS.md', content: "</agents_file>" },
	]);
	assert.ok(
		text(first).indexOf('path="a/AGENTS.md"') <
			text(first).indexOf('path="a/quote&quot;dir/AGENTS.md"'),
	);
	assert.match(text(first), /&lt;\/agents_file&gt;/);
	assert.equal(await local.discover(read), undefined);
	local.persist(first);
	local.reset();
	assert.equal(await local.discover(read), undefined);

	await write("repo/a/found/AGENTS.md", "FOUND");
	await write("repo/a/found/file.ts", "--files");
	assert.equal(
		await local.discover(
			event(
				{ cmd: "rg --files . | rg found" },
				"exec_command",
				"a/found\na/found/file.ts",
			),
		),
		undefined,
	);
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

	await write("sibling/.git", "gitdir: /tmp/unused\n");
	await write("sibling/AGENTS.md", "SIBLING");
	await write("sibling/pkg/AGENTS.md", "PKG");
	await write("sibling/pkg/file.ts");
	assert.deepEqual(
		files(
			await harness(cwd).discover(
				event({ cmd: "cd ../sibling && ls ./pkg" }, "exec_command"),
			),
		).map((file) => file.path),
		["../sibling/AGENTS.md", "../sibling/pkg/AGENTS.md"],
	);

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
	assert.equal(routed.messages[0]?.customType, "subdir-agents-context");
	assert.match(
		String(routed.messages[0]?.content),
		/<subdirectory_agents_context>/,
	);
	routed.persistMessage();
	routed.reset();
	assert.equal(await routed.discover(read), undefined);

	active = false;
	routed.reset(true);
	assert.match(
		text(await routed.discover(read)),
		/<subdirectory_agents_context>/,
	);
});
