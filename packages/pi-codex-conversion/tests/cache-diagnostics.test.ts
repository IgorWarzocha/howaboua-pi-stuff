import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
	codexDiagnosticsLogPath,
	createCodexDiagnosticsLog,
} from "../src/diagnostics/logger.ts";
import { CACHE_MISS_HOLD_MS, createCodexDiagnosticsRuntime } from "../src/diagnostics/runtime.ts";
import type { CodexDiagnosticsEvent } from "../src/providers/openai-codex/types.ts";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
} from "./openai-codex-test-support.ts";
import { context, model, streamOptions, user } from "./websocket-test-support.ts";

test("cache miss status holds for three seconds then shows only the latest event", async () => {
	assert.equal(CACHE_MISS_HOLD_MS, 3_000);
	const statuses: Array<string | undefined> = [];
	const runtime = await createCodexDiagnosticsRuntime({
		mode: "status",
		missHoldMs: 20,
		ctx: {
			ui: {
				theme: { fg: (_role: string, text: string) => text },
				setStatus: (_key: string, value: string | undefined) => statuses.push(value),
				notify: () => undefined,
			},
		} as never,
	});
	const fullRequest: CodexDiagnosticsEvent = {
		type: "request",
		lane: "response",
		transport: "websocket",
		attempt: 1,
		fullInputItems: 40,
		sentInputItems: 40,
		socketReused: false,
		continuation: "no_continuation",
		previousResponseId: false,
	};
	runtime.record(fullRequest);
	runtime.record({
		type: "usage",
		lane: "response",
		transport: "websocket",
		inputTokens: 35_000,
		cachedInputTokens: 0,
		cacheWriteInputTokens: 0,
		outputTokens: 100,
	});
	assert.match(statuses.at(-1) ?? "", /MISS.*35k input/);

	runtime.record({
		...fullRequest,
		fullInputItems: 41,
		sentInputItems: 1,
		socketReused: true,
		continuation: "delta",
		previousResponseId: true,
	});
	assert.match(statuses.at(-1) ?? "", /MISS/);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.match(statuses.at(-1) ?? "", /WS delta/);
	assert.doesNotMatch(statuses.at(-1) ?? "", /MISS/);
	await runtime.shutdown();
});

test("cache diagnostics log is session-derived, readable, and redacts credentials", async () => {
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
			error: "Unauthorized Bearer secret-token-value-123456789",
		});
		await log.close();

		const contents = await readFile(log.path, "utf8");
		assert.match(contents, /Metadata only/);
		assert.match(contents, /event="request" lane="compaction" transport="websocket"/);
		assert.match(contents, /full_input_items=43 sent_input_items=43/);
		assert.match(contents, /Bearer \[redacted\]/);
		assert.doesNotMatch(contents, /secret-token-value/);
		assert.deepEqual(errors, []);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("provider diagnostics report the request decision and authoritative cache usage", async () => {
	const restoreWebSocket = installScriptedWebSocket([[(socket: ScriptedWebSocket) => {
		socket.emitJson({ type: "response.created", response: { id: "resp_diagnostics" } });
		socket.emitJson({
			type: "response.completed",
			response: {
				id: "resp_diagnostics",
				status: "completed",
				usage: {
					input_tokens: 10,
					output_tokens: 1,
					total_tokens: 11,
					input_tokens_details: { cached_tokens: 8 },
				},
			},
		});
	}]]);
	try {
		const events: CodexDiagnosticsEvent[] = [];
		const registered = createRegisteredCodexProvider({
			getDiagnostics: () => (event) => events.push(event),
		});
		await collectStream(registered.provider.streamSimple(
			model as never,
			context([user("diagnose", 1)]) as never,
			streamOptions("cache-diagnostics") as never,
		));

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
