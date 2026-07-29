import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import {
	consumeCodexRateLimitResetCredit,
	createCodexRateLimitResetRedeemRequestId,
	fetchCodexUsage,
	type CodexRateLimitResetConsumeResult,
	type CodexRateLimitResetCredit,
	type CodexUsageSnapshot,
} from "./usage.ts";

export interface UsageTabOptions {
	initialUsage?: CodexUsageSnapshot | { error: string } | undefined;
	onRefreshUsage?: (() => Promise<CodexUsageSnapshot>) | undefined;
	onConsumeResetCredit?: ((redeemRequestId: string) => Promise<CodexRateLimitResetConsumeResult>) | undefined;
}

export interface UsageTabController {
	ensureLoaded(): void;
	handleInput(data: string): boolean;
	render(theme: Theme): string[];
}

export function createUsageTab(ctx: ExtensionContext, options: UsageTabOptions, requestRender: () => void): UsageTabController {
	let usageState = options.initialUsage;
	let usageLoading = false;
	let resetLoading = false;
	let resetLockedUntilRefresh = false;
	let resetRedeemRequestId: string | undefined;
	let resetMessage: { kind: "info" | "error"; text: string } | undefined;

	const load = (unlockReset = false) => {
		if (usageLoading) return;
		usageLoading = true;
		requestRender();
		(options.onRefreshUsage ?? (() => fetchCodexUsage(ctx)))()
			.then((usage) => {
				usageState = usage;
				if (unlockReset) {
					resetLockedUntilRefresh = false;
					resetRedeemRequestId = undefined;
					resetMessage = undefined;
				}
			})
			.catch((error) => { usageState = { error: error instanceof Error ? error.message : String(error) }; })
			.finally(() => { usageLoading = false; requestRender(); });
	};

	const consumeReset = () => {
		if (resetLoading || usageLoading) return;
		if (resetLockedUntilRefresh) {
			resetMessage = { kind: "info", text: "Press R to refresh before using another reset." };
			requestRender();
			return;
		}
		if (!canConsumeResetCredit(usageState)) return;
		resetLoading = true;
		resetMessage = undefined;
		resetRedeemRequestId ??= createCodexRateLimitResetRedeemRequestId();
		const redeemRequestId = resetRedeemRequestId;
		requestRender();
		(options.onConsumeResetCredit ?? ((id) => consumeCodexRateLimitResetCredit(ctx, id)))(redeemRequestId)
			.then((result) => {
				resetMessage = { kind: result.outcome === "reset" || result.outcome === "already_redeemed" ? "info" : "error", text: formatResetConsumeResult(result) };
				resetLockedUntilRefresh = true;
				resetRedeemRequestId = undefined;
				usageState = undefined;
				load();
			})
			.catch((error) => { resetMessage = { kind: "error", text: `${error instanceof Error ? error.message : String(error)} Press Ctrl+R to retry the same reset request, or R to refresh.` }; })
			.finally(() => { resetLoading = false; requestRender(); });
	};

	return {
		ensureLoaded() {
			if (!usageState) load();
		},
		handleInput(data) {
			if (data.toLowerCase() === "r") {
				if (!resetLoading) load(true);
				return true;
			}
			if (matchesKey(data, "ctrl+r")) {
				consumeReset();
				return true;
			}
			return false;
		},
		render(theme) {
			return formatUsageLines(theme, usageState, usageLoading, resetLoading, resetLockedUntilRefresh, resetMessage);
		},
	};
}

function formatUsageLines(theme: Theme, usageState: CodexUsageSnapshot | { error: string } | undefined, loading: boolean, resetLoading: boolean, resetLockedUntilRefresh: boolean, resetMessage: { kind: "info" | "error"; text: string } | undefined): string[] {
	if (!usageState) return [theme.fg("dim", "  Loading Codex usage…")];
	if ("error" in usageState) return [theme.fg("error", `  ${usageState.error}`), theme.fg("dim", "  Press R to retry.")];

	const rows = usageState.limits.map((limit) => {
		const primary = usageColumns(limit.primary);
		const secondary = usageColumns(limit.secondary);
		return [limit.limitName ?? limit.limitId, primary.bar, primary.percent, primary.reset, secondary.bar, secondary.percent, secondary.reset];
	});
	const headers = ["Limit", "5h left", "", "Reset", "Weekly left", "", "Reset"];
	const widths = columnWidths([headers, ...rows]);
	return [
		`  ${theme.bold(`Codex usage${usageState.planType ? ` · ${usageState.planType}` : ""}`)}${loading ? theme.fg("dim", "  refreshing…") : ""}`,
		...formatResetCreditLines(theme, usageState, resetLoading, resetLockedUntilRefresh, resetMessage),
		"",
		formatUsageRow(headers.map((header) => theme.fg("dim", header)), widths),
		theme.fg("borderMuted", `  ${"─".repeat(widths.reduce((sum, width) => sum + width, 0) + (2 * (widths.length - 1)))}`),
		...rows.map((row) => formatUsageRow(row, widths)),
	];
}

function canConsumeResetCredit(usageState: CodexUsageSnapshot | { error: string } | undefined): boolean {
	return Boolean(usageState && !("error" in usageState) && (usageState.resetCredits?.availableCount ?? 0) > 0);
}

function formatResetCreditLines(theme: Theme, usageState: CodexUsageSnapshot, resetLoading: boolean, resetLockedUntilRefresh: boolean, resetMessage: { kind: "info" | "error"; text: string } | undefined): string[] {
	const count = usageState.resetCredits?.availableCount;
	const hint = count && count > 0 ? theme.fg("dim", resetLockedUntilRefresh ? "  R to refresh before another reset" : "  Ctrl+R to use one") : "";
	const lines = [`  Banked resets: ${theme.bold(count === undefined ? "unknown" : String(count))}${hint}${resetLoading ? theme.fg("dim", "  resetting…") : ""}`];
	if (count && count > 0) lines.push(theme.fg("dim", `  Expires: ${formatResetCreditExpiries(usageState.resetCredits?.credits ?? [])}`));
	if (resetMessage) lines.push(resetMessage.kind === "error" ? theme.fg("error", `  ${resetMessage.text}`) : theme.fg("accent", `  ${resetMessage.text}`));
	return lines;
}

function formatResetCreditExpiries(credits: CodexRateLimitResetCredit[]): string {
	const expiringCredits = credits
		.map((credit) => ({ credit, expiresAtMs: credit.expiresAt ? Date.parse(credit.expiresAt) : Number.NaN }))
		.filter((item) => Number.isFinite(item.expiresAtMs) && (!item.credit.status || item.credit.status === "available"))
		.sort((left, right) => left.expiresAtMs - right.expiresAtMs);
	if (expiringCredits.length === 0) return "unknown";
	const shown = expiringCredits.slice(0, 3).map((item, index) => `#${index + 1} ${formatResetCreditExpiry(item.expiresAtMs)}`);
	const hiddenCount = expiringCredits.length - shown.length;
	return `${shown.join(" · ")}${hiddenCount > 0 ? ` · +${hiddenCount} more` : ""}`;
}

function formatResetCreditExpiry(expiresAtMs: number): string {
	const minutes = Math.round((expiresAtMs - Date.now()) / 60000);
	if (minutes <= 0) return "expired";
	if (minutes < 90) return `in ~${minutes}m`;
	if (minutes < 60 * 48) return `in ~${Math.round(minutes / 60)}h`;
	return `in ~${Math.round(minutes / 1440)}d`;
}

function formatResetConsumeResult(result: CodexRateLimitResetConsumeResult): string {
	if (result.outcome === "reset") return "Codex rate limits reset.";
	if (result.outcome === "already_redeemed") return "Reset already applied; refreshed usage.";
	if (result.outcome === "nothing_to_reset") return "No active Codex limit to reset.";
	if (result.outcome === "no_credit") return "No banked resets available.";
	return "Reset response was not recognized; refreshed usage.";
}

function columnWidths(rows: string[][]): number[] {
	const columnCount = Math.max(...rows.map((row) => row.length));
	return Array.from({ length: columnCount }, (_, index) => Math.max(...rows.map((row) => stripAnsi(row[index] ?? "").length)));
}

function stripAnsi(value: string): string { return value.replace(/\x1b\[[0-9;]*m/g, ""); }
function padCell(value: string, width: number): string { return value + " ".repeat(Math.max(0, width - stripAnsi(value).length)); }
function formatUsageRow(row: string[], widths: number[]): string { return `  ${row.map((cell, index) => padCell(cell, widths[index] ?? 0)).join("  ")}`; }

function usageColumns(window: { usedPercent?: number | undefined; windowMinutes?: number | undefined; resetsAt?: number | undefined } | undefined): { bar: string; percent: string; reset: string } {
	if (!window) return { bar: "", percent: "", reset: "" };
	const percent = window.usedPercent === undefined ? undefined : 100 - Math.max(0, Math.min(100, window.usedPercent));
	return { bar: usageBar(percent), percent: percent === undefined ? "?%" : `${Math.round(percent)}%`, reset: formatResetShort(window.resetsAt) };
}

function usageBar(percent: number | undefined): string {
	if (percent === undefined) return "░░░░░░░░░░";
	const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
	return "█".repeat(filled) + "░".repeat(10 - filled);
}

function formatResetShort(timestampSeconds: number | undefined): string {
	if (!timestampSeconds) return "reset ?";
	const minutes = Math.max(0, Math.round((timestampSeconds * 1000 - Date.now()) / 60000));
	if (minutes < 90) return `~${minutes}m`;
	if (minutes < 60 * 48) return `~${Math.round(minutes / 60)}h`;
	return `~${Math.round(minutes / 1440)}d`;
}
