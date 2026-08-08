import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
	codexDiagnosticsLogPath,
	createCodexDiagnosticsLog,
} from "../src/diagnostics/logger.ts";
import { codexDiagnosticsFailure } from "../src/providers/openai-codex/diagnostic-failure.ts";
import type { CodexDiagnosticsEvent } from "../src/providers/openai-codex/types.ts";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
} from "./openai-codex-test-support.ts";
import { context, model, sentFrames, streamOptions, textResponse, user } from "./websocket-test-support.ts";

test("cache diagnostics log is session-derived, readable, and omits raw provider payloads", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-codex-log-"));
	try {
		const sessionId = "019fd7ca-66ba-7c47-8925-d2cdc17e2bd7";
		const sessionFile = `/sessions/2026-08-06T15-56-33-850Z_${sessionId}.jsonl`;
		const path = codexDiagnosticsLogPath({
			agentDir,
			sessionId,
			sessionFile,
			sessionName: "../../ Cache Test",
		});
		assert.equal(dirname(path), join(agentDir, "pi-codex-logs"));
		assert.match(basename(path), /^Cache-Test--2026-08-06T15-56-33-850Z_/);

		const errors: unknown[] = [];
		const log = await createCodexDiagnosticsLog({
			agentDir,
			sessionId,
			sessionFile,
			sessionName: "../../ Cache Test",
			cwd: "/work/project",
			onError: (error) => errors.push(error),
		});
		const providerFailure = Object.assign(new Error("Unauthorized response resp_secret Bearer secret"), {
			code: "invalid_token",
			status: 401,
			payload: { response: { id: "resp_secret", echoed_prompt: "private" } },
		});
		const safeFailure = codexDiagnosticsFailure(providerFailure);
		assert.deepEqual(safeFailure, {
			category: "authentication",
			code: "invalid_token",
			status: 401,
		});
		log.record({
			type: "request",
			lane: "compaction",
			transport: "websocket",
			attempt: 1,
			fullInputItems: 43,
			sentInputItems: 43,
			socketReused: false,
			continuation: "no_continuation",
			previousResponseId: false,
		});
		log.record({
			type: "failure",
			lane: "compaction",
			transport: "websocket",
			failure: safeFailure,
		});
		await log.close();

		const contents = await readFile(log.path, "utf8");
		assert.match(contents, /Metadata only/);
		assert.match(contents, /event="request" lane="compaction" transport="websocket"/);
		assert.match(contents, /full_input_items=43 sent_input_items=43/);
		assert.match(contents, /failure="authentication" code="invalid_token" status=401/);
		assert.doesNotMatch(contents, /error=|resp_secret|echoed_prompt|Bearer/);
		assert.deepEqual(errors, []);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("provider diagnostics are authoritative and cannot alter or leak the stream", async () => {
	const restoreWebSocket = installScriptedWebSocket([[
		(socket: ScriptedWebSocket) => {
			socket.emitJson({ type: "response.created", response: { id: "resp_safe_diagnostics_1" } });
			socket.emitJson({
				type: "response.completed",
				response: {
					id: "resp_safe_diagnostics_1",
					status: "completed",
					usage: {
						input_tokens: 10,
						output_tokens: 1,
						total_tokens: 11,
						input_tokens_details: { cached_tokens: 8 },
					},
				},
			});
		},
		textResponse("resp_safe_diagnostics_2", "second"),
	]]);
	try {
		const events: CodexDiagnosticsEvent[] = [];
		const registered = createRegisteredCodexProvider({
			getDiagnostics: () => (event) => {
				events.push(event);
				throw new Error("diagnostics failed");
			},
		});
		const requestContext = context([user("diagnose safely", 1)]);
		const first = await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions("throwing-cache-diagnostics") as never,
		));
		const second = await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions("throwing-cache-diagnostics") as never,
		));
		assert.equal((first.at(-1) as { type?: string }).type, "done");
		assert.equal((second.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(sentFrames().length, 2);
		assert.deepEqual(events[0], {
			type: "request",
			lane: "response",
			transport: "websocket",
			attempt: 1,
			fullInputItems: 1,
			sentInputItems: 1,
			socketReused: false,
			continuation: "no_continuation",
			previousResponseId: false,
		});
		assert.deepEqual(events[1], {
			type: "usage",
			lane: "response",
			transport: "websocket",
			inputTokens: 2,
			cachedInputTokens: 8,
			cacheWriteInputTokens: 0,
			outputTokens: 1,
		});
	} finally {
		restoreWebSocket();
	}
});
