import type { CodexUsageSnapshot, CodexUsageWindow } from "./payload.ts";

function formatReset(timestampSeconds: number | undefined): string {
	if (!timestampSeconds) return "reset unknown";
	const ms = timestampSeconds * 1000;
	const minutes = Math.max(0, Math.round((ms - Date.now()) / 60000));
	return minutes < 90 ? `resets in ~${minutes}m` : `resets ${new Date(ms).toLocaleString()}`;
}

function formatWindow(label: string, window: CodexUsageWindow | undefined): string | undefined {
	if (!window) return undefined;
	const remainingPercent = window.usedPercent === undefined ? undefined : 100 - Math.max(0, Math.min(100, window.usedPercent));
	const percent = remainingPercent === undefined ? "?" : `${Math.round(remainingPercent)}%`;
	const span = window.windowMinutes ? `${Math.round(window.windowMinutes)}m` : "window";
	return `${label}: ${percent} left (${span}, ${formatReset(window.resetsAt)})`;
}

export function formatCodexUsage(snapshot: CodexUsageSnapshot): string {
	const lines = [`Codex usage${snapshot.planType ? ` (${snapshot.planType})` : ""}:`];
	if (snapshot.resetCredits) lines.push(`- resets available: ${snapshot.resetCredits.availableCount}`);
	for (const limit of snapshot.limits) {
		const title = limit.limitName ?? limit.limitId;
		const parts = [formatWindow("5h", limit.primary), formatWindow("weekly", limit.secondary)].filter(Boolean);
		lines.push(`- ${title}: ${parts.length ? parts.join("; ") : "no usage data"}`);
	}
	return lines.join("\n");
}
