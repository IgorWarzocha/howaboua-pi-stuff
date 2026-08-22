export const CODEX_CACHE_KEEPALIVE_STRATEGIES = [
	"generated-current",
] as const;

export type CodexCacheKeepaliveStrategy =
	(typeof CODEX_CACHE_KEEPALIVE_STRATEGIES)[number];

export const DEFAULT_CODEX_CACHE_KEEPALIVE_INTERVAL_MS = 25 * 60 * 1_000;
const MIN_CODEX_CACHE_KEEPALIVE_INTERVAL_MS = 60 * 1_000;
const MAX_CODEX_CACHE_KEEPALIVE_INTERVAL_MS = 30 * 60 * 1_000;

export interface CodexCacheExperimentEnvironment {
	keepalive?: CodexCacheKeepaliveStrategy | false | undefined;
	keepaliveIntervalMs: number;
	diagnostics?: "off" | "status" | "status-and-log" | undefined;
	logName?: string | undefined;
	warnings: string[];
}

function normalizeKeepalive(value: string): CodexCacheKeepaliveStrategy | false | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized === "off" || normalized === "false" || normalized === "0") return false;
	return (CODEX_CACHE_KEEPALIVE_STRATEGIES as readonly string[]).includes(normalized)
		? normalized as CodexCacheKeepaliveStrategy
		: undefined;
}

export function readCodexCacheExperimentEnvironment(
	env: NodeJS.ProcessEnv = process.env,
): CodexCacheExperimentEnvironment {
	const warnings: string[] = [];
	const rawKeepalive = env["PI_CODEX_CACHE_KEEPALIVE"];
	const parsedKeepalive = rawKeepalive === undefined ? undefined : normalizeKeepalive(rawKeepalive);
	const keepalive = rawKeepalive !== undefined && parsedKeepalive === undefined
		? false
		: parsedKeepalive;
	if (rawKeepalive !== undefined && parsedKeepalive === undefined) {
		warnings.push(
			`PI_CODEX_CACHE_KEEPALIVE must be off, ${CODEX_CACHE_KEEPALIVE_STRATEGIES.join(", ")}`,
		);
	}

	const rawInterval = env["PI_CODEX_CACHE_KEEPALIVE_INTERVAL_MS"];
	let keepaliveIntervalMs = DEFAULT_CODEX_CACHE_KEEPALIVE_INTERVAL_MS;
	if (rawInterval !== undefined) {
		const value = Number(rawInterval);
		if (
			Number.isSafeInteger(value)
			&& value >= MIN_CODEX_CACHE_KEEPALIVE_INTERVAL_MS
			&& value <= MAX_CODEX_CACHE_KEEPALIVE_INTERVAL_MS
		) {
			keepaliveIntervalMs = value;
		} else {
			warnings.push(
				`PI_CODEX_CACHE_KEEPALIVE_INTERVAL_MS must be an integer from ${MIN_CODEX_CACHE_KEEPALIVE_INTERVAL_MS} to ${MAX_CODEX_CACHE_KEEPALIVE_INTERVAL_MS}`,
			);
		}
	}

	const rawDiagnostics = env["PI_CODEX_CACHE_DIAGNOSTICS"]?.trim().toLowerCase();
	const diagnostics = rawDiagnostics === "off" || rawDiagnostics === "status" || rawDiagnostics === "status-and-log"
		? rawDiagnostics
		: undefined;
	if (rawDiagnostics !== undefined && diagnostics === undefined) {
		warnings.push(
			"PI_CODEX_CACHE_DIAGNOSTICS must be off, status, or status-and-log",
		);
	}

	const rawLogName = env["PI_CODEX_CACHE_LOG_NAME"]?.trim();
	const logName = rawLogName && Buffer.byteLength(rawLogName) <= 80 ? rawLogName : undefined;
	if (rawLogName && !logName) warnings.push("PI_CODEX_CACHE_LOG_NAME must be at most 80 bytes");

	return {
		...(keepalive !== undefined ? { keepalive } : {}),
		keepaliveIntervalMs,
		...(diagnostics !== undefined ? { diagnostics } : {}),
		...(logName ? { logName } : {}),
		warnings,
	};
}

export function resolveCodexCacheKeepaliveStrategy(
	configured: boolean,
	experiment: CodexCacheExperimentEnvironment,
): CodexCacheKeepaliveStrategy | false {
	return experiment.keepalive ?? (configured ? "generated-current" : false);
}
