import type { CodexUsageLimit, CodexUsageSnapshot, CodexUsageWindow } from "./payload.ts";
import { CODEX_RESERVE_MODEL } from "./reserve-policy.ts";

export const CODEX_RESERVE_USAGE_NOTE = "Luna Reserve: separate, limited allowance after ordinary quota runs out; availability is backend-controlled.";

export function codexUsageLimitName(limit: CodexUsageLimit): string {
	const name = limit.limitName ?? limit.limitId;
	return name.toLowerCase() === CODEX_RESERVE_MODEL ? "Luna Reserve" : name;
}

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
		const title = codexUsageLimitName(limit);
		const parts = [formatWindow("5h", limit.primary), formatWindow("weekly", limit.secondary)].filter(Boolean);
		lines.push(`- ${title}: ${parts.length ? parts.join("; ") : "no usage data"}`);
	}
	if (snapshot.limits.some((limit) => codexUsageLimitName(limit) === "Luna Reserve")) lines.push(CODEX_RESERVE_USAGE_NOTE);
	return lines.join("\n");
}
