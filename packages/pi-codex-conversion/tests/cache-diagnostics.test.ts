import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
	codexDiagnosticsLogPath,
	createCodexDiagnosticsLog,
} from "../src/diagnostics/logger.ts";
import { createLazyCodexDiagnostics } from "../src/diagnostics/lazy.ts";
import { CACHE_MISS_HOLD_MS, createCodexDiagnosticsRuntime } from "../src/diagnostics/runtime.ts";
import { codexDiagnosticsFailure } from "../src/providers/openai-codex/diagnostic-failure.ts";
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
	assert.match(statuses.at(-1) ?? "", /MISS.*WS full/);
	assert.doesNotMatch(statuses.at(-1) ?? "", /%|35k/);

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
	runtime.record({
		type: "usage",
		lane: "response",
		transport: "websocket",
		inputTokens: 2_000,
		cachedInputTokens: 8_000,
		cacheWriteInputTokens: 0,
		outputTokens: 100,
	});
	assert.match(statuses.at(-1) ?? "", /HIT.*WS delta/);
	assert.doesNotMatch(statuses.at(-1) ?? "", /%|cached/);
	await runtime.shutdown();
});

test("lazy diagnostics sinks are session-bound and exception-safe", async () => {
	const diagnostics = createLazyCodexDiagnostics();
	const statusesA: Array<string | undefined> = [];
	const statusesB: Array<string | undefined> = [];
	let throwFromB = false;
	const contextFor = (sessionId: string, statuses: Array<string | undefined>) => ({
		cwd: "/work/project",
		model,
		sessionManager: {
			getSessionId: () => sessionId,
			getSessionFile: () => `/sessions/${sessionId}.jsonl`,
			getSessionName: () => undefined,
		},
		ui: {
			theme: { fg: (_role: string, text: string) => text },
			setStatus: (_key: string, value: string | undefined) => {
				if (sessionId === "session-b" && throwFromB) throw new Error("UI unavailable");
				statuses.push(value);
			},
			notify: () => undefined,
		},
	}) as never;
	const ctxA = contextFor("session-a", statusesA);
	const ctxB = contextFor("session-b", statusesB);
	await diagnostics.configure({ mode: "status", active: true, ctx: ctxA });
	const staleSink = diagnostics.sink()!;
	await diagnostics.configure({ mode: "status", active: true, ctx: ctxB });
	const currentSink = diagnostics.sink()!;
	const request: CodexDiagnosticsEvent = {
		type: "request",
		lane: "response",
		transport: "websocket",
		attempt: 1,
		fullInputItems: 10,
		sentInputItems: 1,
		socketReused: true,
		continuation: "delta",
		previousResponseId: true,
	};
	const statusCount = statusesB.length;
	staleSink(request);
	assert.equal(statusesB.length, statusCount);
	currentSink(request);
	assert.match(statusesB.at(-1) ?? "", /WS delta/);

	throwFromB = true;
	assert.doesNotThrow(() => currentSink(request));
	assert.doesNotThrow(() => currentSink(request));
	throwFromB = false;
	await diagnostics.shutdown();
});

test("concurrent diagnostics shutdown waits for an in-flight log close", async () => {
	const close = Promise.withResolvers<void>();
	let closeStarted = false;
	const diagnostics = createLazyCodexDiagnostics(async () => ({
		createCodexDiagnosticsRuntime: async () => ({
			record: () => undefined,
			shutdown: async () => {
				closeStarted = true;
				await close.promise;
			},
		}),
	}) as never);
	const ctx = {
		model,
		sessionManager: { getSessionId: () => "concurrent-close" },
		ui: { notify: () => undefined },
	} as never;
	await diagnostics.configure({ mode: "status", active: true, ctx });
	const disable = diagnostics.configure({ mode: "off", active: true, ctx });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(closeStarted, true);
	let shutdownFinished = false;
	const shutdown = diagnostics.shutdown().then(() => { shutdownFinished = true; });
	await Promise.resolve();
	assert.equal(shutdownFinished, false);
	close.resolve();
	await Promise.all([disable, shutdown]);
	assert.equal(shutdownFinished, true);
});

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
			failure: { category: "authentication", status: 401 },
		});
		await log.close();

		const contents = await readFile(log.path, "utf8");
		assert.match(contents, /Metadata only/);
		assert.match(contents, /event="request" lane="compaction" transport="websocket"/);
		assert.match(contents, /full_input_items=43 sent_input_items=43/);
		assert.match(contents, /failure="authentication" status=401/);
		assert.doesNotMatch(contents, /error=|resp_secret|echoed_prompt|Bearer/);
		assert.deepEqual(errors, []);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("provider failures reduce to allowlisted diagnostic metadata", () => {
	const failure = Object.assign(new Error("Unauthorized response resp_secret Bearer secret"), {
		code: "invalid_token",
		status: 401,
		payload: { response: { id: "resp_secret", echoed_prompt: "private" } },
	});
	assert.deepEqual(codexDiagnosticsFailure(failure), {
		category: "authentication",
		code: "invalid_token",
		status: 401,
	});
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
