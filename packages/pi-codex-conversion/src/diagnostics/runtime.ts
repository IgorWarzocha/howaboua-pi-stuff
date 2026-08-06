import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CacheDiagnosticsMode } from "../adapter/activation/config.ts";
import type {
	CodexDiagnosticsEvent,
	CodexDiagnosticsFailure,
	CodexDiagnosticsLane,
} from "../providers/openai-codex/types.ts";

const CACHE_STATUS_KEY = "codex-cache";
const CACHE_STATUS_TEXT = "Codex Cache";
export const CACHE_MISS_HOLD_MS = 3_000;

interface DiagnosticsLog {
	path: string;
	record(event: CodexDiagnosticsEvent): void;
	close(): Promise<void>;
}

export interface CodexDiagnosticsRuntime {
	record(event: CodexDiagnosticsEvent): void;
	shutdown(): Promise<void>;
}

function laneLabel(lane: CodexDiagnosticsLane): string | undefined {
	return lane === "response" ? undefined : lane;
}

function requestTransportLabel(event: Extract<CodexDiagnosticsEvent, { type: "request" }>): string {
	if (event.transport === "sse") return "SSE full";
	if (event.continuation === "delta") return "WS delta";
	return event.continuation ? `WS full (${event.continuation.replaceAll("_", " ")})` : "WS full";
}

function failureLabel(failure: CodexDiagnosticsFailure): string {
	return [
		failure.category.replaceAll("_", " "),
		failure.code,
		failure.status,
	].filter((value) => value !== undefined).join(" • ");
}

export async function createCodexDiagnosticsRuntime(options: {
	mode: Exclude<CacheDiagnosticsMode, "off">;
	ctx: ExtensionContext;
	agentDir: string;
	announceLog?: boolean | undefined;
	missHoldMs?: number | undefined;
}): Promise<CodexDiagnosticsRuntime> {
	const { ctx } = options;
	let log: DiagnosticsLog | undefined;
	let logActive = false;
	let logFailureReported = false;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let holdingMiss = false;
	let latestAfterMiss: string | undefined;
	const latestRequests = new Map<CodexDiagnosticsLane, Extract<CodexDiagnosticsEvent, { type: "request" }>>();

	const themedStatus = (suffix: string, warning = false) => {
		const title = ctx.ui.theme.fg("accent", CACHE_STATUS_TEXT);
		const detail = ctx.ui.theme.fg(warning ? "warning" : "dim", ` • ${suffix}`);
		return `${title}${detail}`;
	};
	const show = (status: string) => ctx.ui.setStatus(CACHE_STATUS_KEY, status);
	const showCurrent = (suffix: string) => {
		const status = themedStatus(`${suffix}${logActive ? " • log" : ""}`);
		if (holdingMiss) latestAfterMiss = status;
		else show(status);
	};
	const holdMiss = (suffix: string) => {
		if (holdTimer) clearTimeout(holdTimer);
		holdingMiss = true;
		latestAfterMiss = undefined;
		show(themedStatus(`${suffix}${logActive ? " • log" : ""}`, true));
		holdTimer = setTimeout(() => {
			holdingMiss = false;
			holdTimer = undefined;
			if (latestAfterMiss) show(latestAfterMiss);
			latestAfterMiss = undefined;
		}, options.missHoldMs ?? CACHE_MISS_HOLD_MS);
		holdTimer.unref?.();
	};
	const reportLogFailure = (error: unknown) => {
		logActive = false;
		if (logFailureReported) return;
		logFailureReported = true;
		ctx.ui.notify(
			`Codex cache logging stopped: ${error instanceof Error ? error.message : String(error)}`,
			"warning",
		);
	};

	if (options.mode === "status-and-log") {
		try {
			const logger = await import("./logger.ts");
			log = await logger.createCodexDiagnosticsLog({
				agentDir: options.agentDir,
				sessionId: ctx.sessionManager.getSessionId(),
				sessionFile: ctx.sessionManager.getSessionFile(),
				sessionName: ctx.sessionManager.getSessionName(),
				cwd: ctx.cwd,
				modelProvider: ctx.model?.provider,
				modelId: ctx.model?.id,
				onError: reportLogFailure,
			});
			logActive = true;
			if (options.announceLog) ctx.ui.notify(`Codex cache log: ${log.path}`, "info");
		} catch (error) {
			reportLogFailure(error);
		}
	}

	showCurrent("waiting");

	return {
		record(event) {
			log?.record(event);
			if (event.type === "request") {
				latestRequests.set(event.lane, event);
				showCurrent([laneLabel(event.lane), requestTransportLabel(event)].filter(Boolean).join(" • "));
				return;
			}
			if (event.type === "usage") {
				const totalInput = event.inputTokens + event.cachedInputTokens + event.cacheWriteInputTokens;
				const request = latestRequests.get(event.lane);
				const transport = request
					? requestTransportLabel(request)
					: event.transport === "websocket" ? "WS" : "SSE";
				const prefix = laneLabel(event.lane);
				if (event.cachedInputTokens === 0 && totalInput > 0) {
					holdMiss([prefix, "MISS", transport].filter(Boolean).join(" • "));
					return;
				}
				showCurrent([prefix, totalInput > 0 ? "HIT" : "cache unavailable", transport].filter(Boolean).join(" • "));
				return;
			}
			if (event.type === "prewarm-ready") {
				showCurrent(`prewarm ready • WS ${event.socketReused ? "reused" : "new"}`);
				return;
			}
			if (event.type === "retry") {
				showCurrent(`${laneLabel(event.lane) ? `${laneLabel(event.lane)} • ` : ""}${event.transport === "websocket" ? "WS" : "SSE"} retry ${event.attempt}`);
				return;
			}
			if (event.type === "fallback") {
				showCurrent(`${laneLabel(event.lane) ? `${laneLabel(event.lane)} • ` : ""}WS → SSE`);
				return;
			}
			showCurrent(`${laneLabel(event.lane) ? `${laneLabel(event.lane)} • ` : ""}${event.transport === "websocket" ? "WS" : "SSE"} failed: ${failureLabel(event.failure)}`);
		},
		async shutdown() {
			if (holdTimer) clearTimeout(holdTimer);
			const failures: unknown[] = [];
			try {
				ctx.ui.setStatus(CACHE_STATUS_KEY, undefined);
			} catch (error) {
				failures.push(error);
			}
			try {
				await log?.close();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) throw new AggregateError(failures, "Codex cache diagnostics shutdown failed");
		},
	};
}
