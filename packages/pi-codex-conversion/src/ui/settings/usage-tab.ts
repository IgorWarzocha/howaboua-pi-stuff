import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { CODEX_RESERVE_USAGE_NOTE, codexUsageLimitName, formatUsageTable, NONSTANDARD_CODEX_USAGE_WARNING } from "../../codex-usage/format.ts";
import { isStandardCodexSubscriptionModel } from "../../adapter/prompt/codex-model.ts";
import { captureSpendReport, readSpendReport } from "../../codex-usage/report.ts";
import { recordCodexManualReset } from "../../codex-usage/ledger-store.ts";
import {
	consumeCodexRateLimitResetCredit,
	createCodexRateLimitResetRedeemRequestId,
	fetchCodexUsage,
} from "../../codex-usage/client.ts";
import type {
	CodexRateLimitResetConsumeResult,
	CodexRateLimitResetCredit,
	CodexUsageSnapshot,
} from "../../codex-usage/payload.ts";

export interface UsageTabOptions {
	initialUsage?: CodexUsageSnapshot | { error: string } | undefined;
	onRefreshUsage?: (() => Promise<CodexUsageSnapshot>) | undefined;
	onConsumeResetCredit?: ((redeemRequestId: string) => Promise<CodexRateLimitResetConsumeResult>) | undefined;
}

export interface UsageTabController {
	ensureLoaded(): void;
	handleInput(data: string): boolean;
	render(theme: Theme, width: number): string[];
}

export function createUsageTab(ctx: ExtensionContext, options: UsageTabOptions, render: () => void, signal: AbortSignal): UsageTabController {
	const requestRender = () => { if (!signal.aborted) render(); };
	let usageState = options.initialUsage;
	let spendLines: string[] = [];
	let nonstandard = ctx.model?.api === "openai-codex-responses" && !isStandardCodexSubscriptionModel(ctx.model);
	let usageLoading = false;
	let resetLoading = false;
	let resetLockedUntilRefresh = false;
	let resetRedeemRequestId: string | undefined;
	let resetMessage: { kind: "info" | "error"; text: string } | undefined;

	const load = (unlockReset = false) => {
		if (usageLoading || signal.aborted) return;
		usageLoading = true;
		requestRender();
		(options.onRefreshUsage ?? (() => fetchCodexUsage(ctx, (key, custom) => {
			nonstandard = custom;
			spendLines = readSpendReport(key);
			requestRender();
		})))()
			.then(async (usage) => {
				if (signal.aborted) return;
				usageState = usage;
				spendLines = await captureSpendReport(usage, {
					sessionDir: ctx.sessionManager.getSessionDir(), signal,
					onProgress: (lines) => { spendLines = lines; requestRender(); },
				});
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
		const accountKey = usageState && !("error" in usageState) ? usageState.accountKey : undefined;
		requestRender();
		(options.onConsumeResetCredit ?? ((id) => consumeCodexRateLimitResetCredit(ctx, id)))(redeemRequestId)
			.then(async (result) => {
				if ((result.outcome === "reset" || result.outcome === "already_redeemed") && accountKey) await recordCodexManualReset(accountKey);
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
		render(theme, width) {
			const warning = nonstandard || (usageState && !("error" in usageState) && usageState.nonstandard) || spendLines.includes(NONSTANDARD_CODEX_USAGE_WARNING);
			return [
				...(warning ? [...wrapTextWithAnsi(NONSTANDARD_CODEX_USAGE_WARNING, Math.max(1, width - 2)).map((line) => theme.fg("warning", `  ${line}`)), ""] : []),
				...formatUsageLines(theme, usageState, usageLoading, resetLoading, resetLockedUntilRefresh, resetMessage, spendLines.filter((line) => line !== NONSTANDARD_CODEX_USAGE_WARNING)),
			];
		},
	};
}

function formatUsageLines(theme: Theme, usageState: CodexUsageSnapshot | { error: string } | undefined, loading: boolean, resetLoading: boolean, resetLockedUntilRefresh: boolean, resetMessage: { kind: "info" | "error"; text: string } | undefined, spendLines: string[]): string[] {
	if (!usageState) return [...spendLines.map((line) => `  ${line}`), theme.fg("dim", "  Loading Codex usage…")];
	if ("error" in usageState) return [...spendLines.map((line) => `  ${line}`), theme.fg("error", `  ${usageState.error}`), theme.fg("dim", "  Press R to retry.")];

	const rows = usageState.limits.flatMap((limit) => {
		const name = codexUsageLimitName(limit);
		const windows = [["5h", limit.primary], ["Weekly", limit.secondary]] as const;
		const rows = windows.flatMap(([label, window]) => {
			if (!window) return [];
			const { bar, percent, reset } = usageColumns(window);
			return [[limit.limitId === "codex" ? label : `${name} · ${label}`, `${bar} ${percent.padStart(4)}`, reset]];
		});
		return rows.length ? rows : [[name, "No data", ""]];
	});
	const [header, ...allowances] = formatUsageTable(["Limit", "Remaining", "Resets in"], rows);
	return [
		`  ${theme.bold(`Codex usage${usageState.planType ? ` · ${usageState.planType}` : ""}`)}${loading ? theme.fg("dim", "  refreshing…") : ""}`,
		...spendLines.map((line) => `  ${line}`),
		"",
		theme.fg("dim", `  ${header}`),
		...allowances.map((row) => `  ${row}`),
		...(usageState.limits.some((limit) => codexUsageLimitName(limit) === "Luna Reserve") ? ["", theme.fg("dim", `  ${CODEX_RESERVE_USAGE_NOTE}`)] : []),
		"",
		...formatResetCreditLines(theme, usageState, resetLoading, resetLockedUntilRefresh, resetMessage),
		"", theme.fg("dim", "  /codex usage analyse"),
	];
}

function canConsumeResetCredit(usageState: CodexUsageSnapshot | { error: string } | undefined): boolean {
	return Boolean(usageState && !("error" in usageState) && (usageState.resetCredits?.availableCount ?? 0) > 0);
}

function formatResetCreditLines(theme: Theme, usageState: CodexUsageSnapshot, resetLoading: boolean, resetLockedUntilRefresh: boolean, resetMessage: { kind: "info" | "error"; text: string } | undefined): string[] {
	const count = usageState.resetCredits?.availableCount;
	const hint = count && count > 0 && resetLockedUntilRefresh ? theme.fg("dim", "  R to refresh before another reset") : "";
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
	const shown = expiringCredits.slice(0, 3).map((item) => formatResetCreditExpiry(item.expiresAtMs));
	const hiddenCount = expiringCredits.length - shown.length;
	return `${shown.join(" · ")}${hiddenCount > 0 ? ` · +${hiddenCount} more` : ""}`;
}

function formatResetCreditExpiry(expiresAtMs: number): string {
	const minutes = Math.round((expiresAtMs - Date.now()) / 60000);
	if (minutes <= 0) return "expired";
	if (minutes < 90) return `${minutes}m`;
	if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h`;
	return `${Math.round(minutes / 1440)}d`;
}

function formatResetConsumeResult(result: CodexRateLimitResetConsumeResult): string {
	if (result.outcome === "reset") return "Codex rate limits reset.";
	if (result.outcome === "already_redeemed") return "Reset already applied; refreshed usage.";
	if (result.outcome === "nothing_to_reset") return "No active Codex limit to reset.";
	if (result.outcome === "no_credit") return "No banked resets available.";
	return "Reset response was not recognized; refreshed usage.";
}

function usageColumns(window: { usedPercent?: number | undefined; resetsAt?: number | undefined }): { bar: string; percent: string; reset: string } {
	const percent = window.usedPercent === undefined ? undefined : 100 - Math.max(0, Math.min(100, window.usedPercent));
	return { bar: usageBar(percent), percent: percent === undefined ? "?%" : `${Math.round(percent)}%`, reset: formatResetShort(window.resetsAt) };
}

function usageBar(percent: number | undefined): string {
	if (percent === undefined) return "░░░░░░░░░░";
	const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
	return "█".repeat(filled) + "░".repeat(10 - filled);
}

function formatResetShort(timestampSeconds: number | undefined): string {
	if (!timestampSeconds) return "?";
	const minutes = Math.max(0, Math.round((timestampSeconds * 1000 - Date.now()) / 60000));
	if (minutes < 90) return `${minutes}m`;
	if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h`;
	return `${Math.round(minutes / 1440)}d`;
}
