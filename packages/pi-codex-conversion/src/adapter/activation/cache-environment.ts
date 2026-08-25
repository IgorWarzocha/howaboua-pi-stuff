export interface CodexCacheEnvironment {
	diagnostics?: "off" | "status" | "status-and-log" | undefined;
	logName?: string | undefined;
	warnings: string[];
}

export function readCodexCacheEnvironment(
	env: NodeJS.ProcessEnv = process.env,
): CodexCacheEnvironment {
	const warnings: string[] = [];
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
		...(diagnostics !== undefined ? { diagnostics } : {}),
		...(logName ? { logName } : {}),
		warnings,
	};
}
