import { getSettingsListTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Focusable, Input, matchesKey, SettingsList, Spacer, Text, truncateToWidth, type SettingItem } from "@earendil-works/pi-tui";
import {
	COMPACTION_MODELS,
	COMPACTION_REASONING_LEVELS,
	DEFAULT_CODEX_CONVERSION_CONFIG,
	WEB_SEARCH_MODELS,
	normalizeCodexVerbosity,
	normalizeCompactionModel,
	normalizeCompactionReasoning,
	normalizeProviderList,
	normalizeWebSearchModel,
	readCodexConversionConfig,
	type CodexConversionConfig,
} from "../../adapter/activation/config.ts";
import { editorCommand, openCodexConfigInExternalEditor } from "./config-editor.ts";
import { CHANGELOG_URL, DISCORD_URL, GITHUB_URL, ISSUE_URL, openExternalUrl } from "./links.ts";
import { consumeCodexRateLimitResetCredit, createCodexRateLimitResetRedeemRequestId, fetchCodexUsage, type CodexRateLimitResetConsumeResult, type CodexRateLimitResetCredit, type CodexUsageSnapshot } from "./usage.ts";

export interface CodexSettingsScreenOptions {
	initialConfig: CodexConversionConfig;
	onChange: (nextConfig: CodexConversionConfig) => boolean;
	initialTab?: SettingsTab | undefined;
	initialUsage?: CodexUsageSnapshot | { error: string } | undefined;
	onRefreshUsage?: () => Promise<CodexUsageSnapshot>;
	onConsumeResetCredit?: (redeemRequestId: string) => Promise<CodexRateLimitResetConsumeResult>;
}

type SettingsTab = "general" | "tools" | "openai" | "usage" | "about";

const TAB_ORDER: readonly SettingsTab[] = ["general", "tools", "openai", "usage", "about"];

class TextSettingSubmenu extends Container implements Focusable {
	private input: Input;
	private theme: Theme;

	constructor(title: string, description: string, currentValue: string, onSubmit: (value: string) => void, onCancel: () => void, theme: Theme) {
		super();
		this.theme = theme;
		this.input = new Input();
		this.input.setValue(currentValue);
		this.input.onSubmit = () => onSubmit(this.input.getValue());
		this.input.onEscape = onCancel;
		this.addChild(new Text(this.theme.bold(this.theme.fg("accent", title)), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("dim", description), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.input);
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("dim", "  Enter to save · Esc to cancel"), 0, 0));
	}

	get focused(): boolean {
		return this.input.focused;
	}

	set focused(value: boolean) {
		this.input.focused = value;
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}
}

export async function openCodexSettingsScreen(ctx: ExtensionContext, options: CodexSettingsScreenOptions): Promise<void> {
	let draft = { ...options.initialConfig };
	let activeTab: SettingsTab = options.initialTab ?? "general";
	let usageState: CodexUsageSnapshot | { error: string } | undefined = options.initialUsage;
	let usageLoading = false;
	let resetLoading = false;
	let resetLockedUntilRefresh = false;
	let resetRedeemRequestId: string | undefined;
	let resetMessage: { kind: "info" | "error"; text: string } | undefined;

	const loadUsage = (requestRender: () => void, loadOptions?: { unlockReset?: boolean }) => {
		if (usageLoading) return;
		if (loadOptions?.unlockReset) {
			resetLockedUntilRefresh = false;
			resetRedeemRequestId = undefined;
			resetMessage = undefined;
		}
		usageLoading = true;
		requestRender();
		(options.onRefreshUsage ?? (() => fetchCodexUsage(ctx)))()
			.then((usage) => { usageState = usage; })
			.catch((error) => { usageState = { error: error instanceof Error ? error.message : String(error) }; })
			.finally(() => { usageLoading = false; requestRender(); });
	};

	const consumeResetCredit = (requestRender: () => void) => {
		if (resetLoading) return;
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
				loadUsage(requestRender);
			})
			.catch((error) => { resetMessage = { kind: "error", text: `${error instanceof Error ? error.message : String(error)} Press Ctrl+R to retry the same reset request, or R to refresh.` }; })
			.finally(() => { resetLoading = false; requestRender(); });
	};

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const runEditConfig = async (stopTui: () => void, startTui: () => void, requestRender: (full?: boolean) => void) => {
			if (!options.onChange(draft)) {
				ctx.ui.notify("Could not save settings before opening editor", "warning");
				return;
			}
			const result = await openCodexConfigInExternalEditor(stopTui, startTui, requestRender);
			if (!result.ok) {
				ctx.ui.notify(result.error, "warning");
				return;
			}
			draft = readCodexConversionConfig();
			options.onChange(draft);
		};

		let settingsList = createSettingsList(activeTab, draft, options, theme, (nextDraft) => {
			draft = nextDraft;
		}, done, () => tui.requestRender(), () => runEditConfig(() => tui.stop(), () => tui.start(), (full) => tui.requestRender(full)));
		if (activeTab === "usage" && !usageState) loadUsage(() => tui.requestRender());

		const switchTab = () => {
			const currentIndex = TAB_ORDER.indexOf(activeTab);
			activeTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length] ?? "general";
			settingsList = createSettingsList(activeTab, draft, options, theme, (nextDraft) => {
				draft = nextDraft;
			}, done, () => tui.requestRender(), () => runEditConfig(() => tui.stop(), () => tui.start(), (full) => tui.requestRender(full)));
			if (activeTab === "usage" && !usageState) loadUsage(() => tui.requestRender());
			tui.requestRender();
		};

		return {
			render: (width: number) => {
				const hasSettingsList = activeTab !== "usage" && activeTab !== "about";
				return [
					rule(width, theme, "accent"),
					formatTabs(activeTab, theme),
					rule(width, theme, "borderMuted"),
					...(activeTab === "usage" ? formatUsageLines(theme, usageState, usageLoading, resetLoading, resetLockedUntilRefresh, resetMessage) : []),
					...(activeTab === "about" ? formatLinks(theme) : []),
					"",
					...(hasSettingsList ? withSettingsFooter(settingsList.render(width), theme) : [theme.fg("dim", formatFooter(activeTab))]),
					rule(width, theme, "accent"),
				].map((line) => truncateToWidth(line, width, ""));
			},
			invalidate: () => settingsList.invalidate(),
			handleInput: (data: string) => {
				if (data === "\t") {
					switchTab();
					return;
				}
				if (activeTab === "about" && handleLinkKey(data, ctx)) return;
				if (activeTab === "usage" && data.toLowerCase() === "r") {
					if (!resetLoading) loadUsage(() => tui.requestRender(), { unlockReset: true });
					return;
				}
				if (activeTab === "usage" && matchesKey(data, "ctrl+r")) {
					consumeResetCredit(() => tui.requestRender());
					return;
				}
				settingsList.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}



function rule(width: number, theme: Theme, color: "accent" | "borderMuted"): string {
	return theme.fg(color, "─".repeat(Math.max(0, width)));
}

function createSettingsList(
	tab: SettingsTab,
	draft: CodexConversionConfig,
	options: CodexSettingsScreenOptions,
	theme: Theme,
	onDraftChanged: (draft: CodexConversionConfig) => void,
	done: (value?: void) => void,
	requestRender: () => void,
	onEditConfig: () => void,
): SettingsList {
	let settingsList: SettingsList;
	settingsList = new SettingsList(buildItems(tab, draft, theme), 8, getSettingsListTheme(), (id, value) => {
		if (id === "editConfig") {
			onEditConfig();
			return;
		}
		const nextDraft = applySettingChange(id, value, draft);
		const previousValue = buildItems(tab, draft, theme).find((item) => item.id === id)?.currentValue;
		if (options.onChange(nextDraft)) {
			onDraftChanged(nextDraft);
			draft = nextDraft;
		} else if (previousValue !== undefined) {
			settingsList.updateValue(id, previousValue);
		}
		requestRender();
	}, () => done(undefined));
	return settingsList;
}

function buildItems(tab: SettingsTab, draft: CodexConversionConfig, theme: Theme): SettingItem[] {
	if (tab === "usage" || tab === "about") return [];

	if (tab === "tools") {
		return [
			{ id: "shellCommands", label: "Shell commands", currentValue: "required", values: ["required"] },
			{ id: "applyPatch", label: "Apply patch", currentValue: "required", values: ["required"] },
			{ id: "viewImage", label: "View image", currentValue: "required", values: ["required"] },
			{ id: "webRun", label: "Web search", currentValue: draft.tools.webRun ? "on" : "off", values: ["off", "on"] },
			{ id: "imageGeneration", label: "Image generation", currentValue: draft.tools.imageGeneration ? "on" : "off", values: ["off", "on"] },
			{ id: "applyPatchOnly", label: "Only add apply_patch", currentValue: draft.tools.applyPatchOnly ? "on" : "off", values: ["off", "on"] },
		];
	}

	if (tab === "openai") {
		return [
			{ id: "fast", label: "Fast mode", currentValue: draft.openai.fast ? "on" : "off", values: ["off", "on"] },
			{ id: "verbosity", label: "Verbosity", currentValue: draft.openai.verbosity, values: ["low", "medium", "high"] },
			{ id: "forceCachedWebSockets", label: "Cached websocket upgrade", currentValue: draft.openai.forceCachedWebSockets ? "on" : "off", values: ["off", "on"] },
			{ id: "webSearchModel", label: "Web search model", currentValue: draft.openai.webSearchModel, values: [...WEB_SEARCH_MODELS] },
			{ id: "compactionModel", label: "Compaction model", currentValue: draft.openai.compactionModel, values: [...COMPACTION_MODELS] },
			{ id: "compactionReasoning", label: "Compaction reasoning", currentValue: draft.openai.compactionReasoning, values: [...COMPACTION_REASONING_LEVELS] },
		];
	}

	return [
		{ id: "mode", label: "PATH mode", currentValue: draft.mode === "path" ? "on" : "off", values: ["off", "on"] },
		{ id: "allProviders", label: "Use for all providers/models", currentValue: draft.scope.allProviders ? "on" : "off", values: ["off", "on"] },
		{
			id: "additionalProviders",
			label: "Additional providers",
			currentValue: formatProviderList(draft.scope.additionalProviders),
			submenu: (currentValue, done) => new TextSettingSubmenu("Additional providers", "Comma-separated provider ids that should also use the selected adapter mode.", currentValue, (value) => done(formatProviderList(normalizeProviderListFromText(value))), () => done(), theme),
		},
		{ id: "statusLine", label: "Statusline", currentValue: draft.ui.statusLine ? "on" : "off", values: ["off", "on"] },
		{ id: "toolRendering", label: "Tool rendering", currentValue: draft.ui.toolRendering ? "on" : "off", values: ["off", "on"] },
		{ id: "backgroundShellWidget", label: "Background shells widget", currentValue: draft.ui.backgroundShellWidget ? "on" : "off", values: ["off", "on"] },
		{ id: "responsesCompaction", label: "Responses compaction", currentValue: draft.compaction.responsesCompaction ? "on" : "off", values: ["off", "on"] },
		{ id: "editConfig", label: "Edit config", currentValue: editorCommand() ? "Opens in default editor (please /reload)" : "Set $EDITOR", values: editorCommand() ? ["Open"] : ["Unavailable"] },
	];
}

function applySettingChange(id: string, value: string, draft: CodexConversionConfig): CodexConversionConfig {
	if (id === "mode") return { ...draft, mode: value === "on" ? "path" : "normal" };
	if (id === "allProviders") return { ...draft, scope: { ...draft.scope, allProviders: value === "on" } };
	if (id === "additionalProviders") return { ...draft, scope: { ...draft.scope, additionalProviders: normalizeProviderListFromText(value) } };
	if (id === "statusLine") return { ...draft, ui: { ...draft.ui, statusLine: value === "on" } };
	if (id === "toolRendering") return { ...draft, ui: { ...draft.ui, toolRendering: value === "on" } };
	if (id === "backgroundShellWidget") return { ...draft, ui: { ...draft.ui, backgroundShellWidget: value === "on" } };
	if (id === "responsesCompaction") return { ...draft, compaction: { ...draft.compaction, responsesCompaction: value === "on" } };
	if (id === "webRun") return { ...draft, tools: { ...draft.tools, webRun: value === "on" } };
	if (id === "imageGeneration") return { ...draft, tools: { ...draft.tools, imageGeneration: value === "on" } };
	if (id === "applyPatchOnly") return { ...draft, tools: { ...draft.tools, applyPatchOnly: value === "on" } };
	if (id === "fast") return { ...draft, openai: { ...draft.openai, fast: value === "on" } };
	if (id === "forceCachedWebSockets") return { ...draft, openai: { ...draft.openai, forceCachedWebSockets: value === "on" } };
	if (id === "webSearchModel") return { ...draft, openai: { ...draft.openai, webSearchModel: normalizeWebSearchModel(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai.webSearchModel } };
	if (id === "compactionModel") return { ...draft, openai: { ...draft.openai, compactionModel: normalizeCompactionModel(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai.compactionModel } };
	if (id === "compactionReasoning") return { ...draft, openai: { ...draft.openai, compactionReasoning: normalizeCompactionReasoning(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai.compactionReasoning } };
	if (id === "verbosity") return { ...draft, openai: { ...draft.openai, verbosity: normalizeCodexVerbosity(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai.verbosity } };
	return draft;
}

function formatProviderList(providers: string[]): string {
	return providers.join(", ");
}

function normalizeProviderListFromText(value: string): string[] {
	return normalizeProviderList(value.split(","));
}

function formatTabs(activeTab: SettingsTab, theme: Theme): string {
	const renderTab = (tab: SettingsTab, label: string) => activeTab === tab ? theme.bold(label) : theme.fg("dim", label);
	return `  ${renderTab("general", "General")}  ${theme.fg("dim", "/")}  ${renderTab("tools", "Tools")}  ${theme.fg("dim", "/")}  ${renderTab("openai", "OpenAI")}  ${theme.fg("dim", "/")}  ${renderTab("usage", "Usage")}  ${theme.fg("dim", "/")}  ${renderTab("about", "About")}`;
}

function formatFooter(activeTab: SettingsTab): string {
	if (activeTab === "usage") return "  Tab to switch sections · R to refresh · Ctrl+R to use reset";
	if (activeTab === "about") return "  Tab to switch sections · G/C/D/I to open links · Esc to close";
	return "  Tab to switch sections · Esc to close";
}

function withSettingsFooter(lines: string[], theme: Theme): string[] {
	const next = [...lines];
	for (let index = next.length - 1; index >= 0; index -= 1) {
		if (next[index]?.includes("Enter/Space")) {
			next[index] = theme.fg("dim", "  Enter/Space to change · Esc to close · Tab to switch sections");
			break;
		}
	}
	return next;
}

function formatUsageLines(theme: Theme, usageState: CodexUsageSnapshot | { error: string } | undefined, loading: boolean, resetLoading: boolean, resetLockedUntilRefresh: boolean, resetMessage: { kind: "info" | "error"; text: string } | undefined): string[] {
	if (loading && !usageState) return [theme.fg("dim", "  Loading Codex usage…")];
	if (!usageState) return [theme.fg("dim", "  Loading Codex usage…")];
	if ("error" in usageState) return [theme.fg("error", `  ${usageState.error}`), theme.fg("dim", "  Press R to retry.")];

	const rows = usageState.limits.map((limit) => {
		const primary = usageColumns(limit.primary);
		const secondary = usageColumns(limit.secondary);
		return [limit.limitName ?? limit.limitId, primary.bar, primary.percent, primary.reset, secondary.bar, secondary.percent, secondary.reset];
	});
	const headers = ["Limit", "5h left", "", "Reset", "Weekly left", "", "Reset"];
	const widths = columnWidths([headers, ...rows]);
	const resetLines = formatResetCreditLines(theme, usageState, resetLoading, resetLockedUntilRefresh, resetMessage);
	return [
		`  ${theme.bold(`Codex usage${usageState.planType ? ` · ${usageState.planType}` : ""}`)}${loading ? theme.fg("dim", "  refreshing…") : ""}`,
		...resetLines,
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
	const lines = [
		`  Banked resets: ${theme.bold(count === undefined ? "unknown" : String(count))}${hint}${resetLoading ? theme.fg("dim", "  resetting…") : ""}`,
	];
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

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function padCell(value: string, width: number): string {
	return value + " ".repeat(Math.max(0, width - stripAnsi(value).length));
}

function formatUsageRow(row: string[], widths: number[]): string {
	return `  ${row.map((cell, index) => padCell(cell, widths[index] ?? 0)).join("  ")}`;
}

function usageColumns(window: { usedPercent?: number | undefined; windowMinutes?: number | undefined; resetsAt?: number | undefined } | undefined): { bar: string; percent: string; reset: string } {
	if (!window) return { bar: "—", percent: "", reset: "" };
	const percent = window.usedPercent === undefined ? undefined : 100 - Math.max(0, Math.min(100, window.usedPercent));
	return {
		bar: bar(percent),
		percent: percent === undefined ? "?%" : `${Math.round(percent)}%`,
		reset: formatResetShort(window.resetsAt),
	};
}

function bar(percent: number | undefined): string {
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

function formatLinks(theme: Theme): string[] {
	return [
		`${theme.bold("g")} github  ${theme.fg("dim", GITHUB_URL)}`,
		`${theme.bold("c")} changes ${theme.fg("dim", CHANGELOG_URL)}`,
		`${theme.bold("d")} discord ${theme.fg("dim", DISCORD_URL)}`,
		`${theme.bold("i")} issue   ${theme.fg("dim", ISSUE_URL)}`,
	];
}

function handleLinkKey(data: string, ctx: ExtensionContext): boolean {
	const target = getLinkTarget(data);
	if (!target) return false;
	openExternalUrl(target.url);
	ctx.ui.notify(target.message, "info");
	return true;
}

function getLinkTarget(data: string): { url: string; message: string } | undefined {
	switch (data.toLowerCase()) {
		case "g":
			return { url: GITHUB_URL, message: "Opened GitHub" };
		case "c":
			return { url: CHANGELOG_URL, message: "Opened changelog" };
		case "d":
			return { url: DISCORD_URL, message: "Opened Discord" };
		case "i":
			return { url: ISSUE_URL, message: "Opened issue form" };
		default:
			return undefined;
	}
}
