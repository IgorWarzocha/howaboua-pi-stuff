import { getSettingsListTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Focusable, Input, SettingsList, Spacer, Text, truncateToWidth, type SettingItem } from "@earendil-works/pi-tui";
import {
	COMPACTION_MODELS,
	COMPACTION_REASONING_LEVELS,
	DEFAULT_CODEX_CONVERSION_CONFIG,
	normalizeCodexVerbosity,
	normalizeCompactionModel,
	normalizeCompactionReasoning,
	normalizeProviderList,
	readCodexConversionConfig,
	type CodexConversionConfig,
} from "../adapter/config.ts";
import { editorCommand, openCodexConfigInExternalEditor } from "./config-editor.ts";
import { CHANGELOG_URL, DISCORD_URL, GITHUB_URL, ISSUE_URL, openExternalUrl } from "./links.ts";
import { fetchCodexUsage, type CodexUsageSnapshot } from "./usage.ts";

export interface CodexSettingsScreenOptions {
	initialConfig: CodexConversionConfig;
	onChange: (nextConfig: CodexConversionConfig) => boolean;
	initialTab?: SettingsTab | undefined;
	initialUsage?: CodexUsageSnapshot | { error: string } | undefined;
	onRefreshUsage?: () => Promise<CodexUsageSnapshot>;
}

type SettingsTab = "general" | "compaction" | "usage" | "overrides" | "about";

const TAB_ORDER: readonly SettingsTab[] = ["general", "compaction", "usage", "overrides", "about"];

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

	const loadUsage = (requestRender: () => void) => {
		if (usageLoading) return;
		usageLoading = true;
		requestRender();
		(options.onRefreshUsage ?? (() => fetchCodexUsage(ctx)))()
			.then((usage) => { usageState = usage; })
			.catch((error) => { usageState = { error: error instanceof Error ? error.message : String(error) }; })
			.finally(() => { usageLoading = false; requestRender(); });
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
					...(activeTab === "compaction" ? formatCompactionNotes(theme) : []),
					...(activeTab === "overrides" ? formatOverridesNotes(theme) : []),
					...(activeTab === "usage" ? formatUsageLines(theme, usageState, usageLoading) : []),
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
					loadUsage(() => tui.requestRender());
					return;
				}
				settingsList.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}

function formatCompactionNotes(theme: Theme): string[] {
	return [
		theme.fg("dim", "  Beta: native OpenAI Responses compaction is experimental. Please report any issues."),
		theme.fg("error", "  Warning: do not turn this off or switch providers mid-session; old context may be much less reliable."),
		theme.fg("warning", "  If native compaction recovery fails, go back below 90% context and compact from there."),
	];
}

function formatOverridesNotes(theme: Theme): string[] {
	return [
		theme.fg("dim", "  Advanced tool-surface overrides."),
	];
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

	if (tab === "compaction") {
		return [
			{ id: "responsesCompaction", label: "Responses compaction", currentValue: (draft.responsesCompaction ?? false) ? "on" : "off", values: ["off", "on"] },
			{ id: "compactionModel", label: "Model", currentValue: draft.compactionModel, values: [...COMPACTION_MODELS] },
			{ id: "compactionReasoning", label: "Reasoning", currentValue: draft.compactionReasoning, values: [...COMPACTION_REASONING_LEVELS] },
		];
	}

	if (tab === "overrides") {
		return [
			{ id: "applyPatchOnly", label: "Apply patch only", currentValue: draft.applyPatchOnly ? "on" : "off", values: ["off", "on"] },
			{ id: "useAdapterProviders", label: "Codex proxy", currentValue: draft.useAdapterProviders ? "on" : "off", values: ["off", "on"] },
			{ id: "adapterProviderCodexTools", label: "Proxy tools", currentValue: draft.adapterProviderCodexTools ? "on" : "off", values: ["off", "on"] },
			{
				id: "adapterProviders",
				label: "Proxy providers",
				currentValue: formatProviderList(draft.adapterProviders),
				submenu: (currentValue, done) => new TextSettingSubmenu("Proxy providers", "Comma-separated Pi provider ids that should use the Codex adapter.", currentValue, (value) => done(formatProviderList(normalizeProviderListFromText(value))), () => done(), theme),
			},
			{ id: "editConfig", label: "Edit config", currentValue: editorCommand() ? "Opens in default editor (please /reload)" : "Set $EDITOR", values: editorCommand() ? ["Open"] : ["Unavailable"] },
		];
	}

	return [
		{ id: "useOnAllModels", label: "Use on all models", currentValue: draft.useOnAllModels ? "on" : "off", values: ["off", "on"] },
		{ id: "statusLine", label: "Statusline", currentValue: draft.statusLine ? "on" : "off", values: ["off", "on"] },
		{ id: "backgroundShellWidget", label: "Background shells widget", currentValue: draft.backgroundShellWidget ? "on" : "off", values: ["off", "on"] },
		{ id: "fast", label: "Fast mode", currentValue: draft.fast ? "on" : "off", values: ["off", "on"] },
		{ id: "forceCachedWebSockets", label: "Codex cached websocket upgrade", currentValue: draft.forceCachedWebSockets === false ? "off" : "on", values: ["off", "on"] },
		{ id: "webSearch", label: "Web search", currentValue: draft.webSearch ? "on" : "off", values: ["off", "on"] },
		{ id: "imageGeneration", label: "Image generation", currentValue: draft.imageGeneration ? "on" : "off", values: ["off", "on"] },
		{ id: "verbosity", label: "Verbosity", currentValue: draft.verbosity, values: ["low", "medium", "high"] },
	];
}

function applySettingChange(id: string, value: string, draft: CodexConversionConfig): CodexConversionConfig {
	const nextDraft = { ...draft };
	if (id === "applyPatchOnly") nextDraft.applyPatchOnly = value === "on";
	if (id === "adapterProviders") nextDraft.adapterProviders = normalizeProviderListFromText(value);
	if (id === "adapterProviderCodexTools") nextDraft.adapterProviderCodexTools = value === "on";
	if (id === "useOnAllModels") nextDraft.useOnAllModels = value === "on";
	if (id === "useAdapterProviders") nextDraft.useAdapterProviders = value === "on";
	if (id === "statusLine") nextDraft.statusLine = value === "on";
	if (id === "backgroundShellWidget") nextDraft.backgroundShellWidget = value === "on";
	if (id === "fast") nextDraft.fast = value === "on";
	if (id === "forceCachedWebSockets") nextDraft.forceCachedWebSockets = value === "on";
	if (id === "webSearch") nextDraft.webSearch = value === "on";
	if (id === "imageGeneration") nextDraft.imageGeneration = value === "on";
	if (id === "responsesCompaction") nextDraft.responsesCompaction = value === "on";
	if (id === "compactionModel") nextDraft.compactionModel = normalizeCompactionModel(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.compactionModel;
	if (id === "compactionReasoning") nextDraft.compactionReasoning = normalizeCompactionReasoning(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.compactionReasoning;
	if (id === "verbosity") nextDraft.verbosity = normalizeCodexVerbosity(value) ?? DEFAULT_CODEX_CONVERSION_CONFIG.verbosity;
	return nextDraft;
}

function formatProviderList(providers: string[]): string {
	return providers.join(", ");
}

function normalizeProviderListFromText(value: string): string[] {
	return normalizeProviderList(value.split(","));
}

function formatTabs(activeTab: SettingsTab, theme: Theme): string {
	const renderTab = (tab: SettingsTab, label: string) => activeTab === tab ? theme.bold(label) : theme.fg("dim", label);
	return `  ${renderTab("general", "General")}  ${theme.fg("dim", "/")}  ${renderTab("compaction", "Compaction")}  ${theme.fg("dim", "/")}  ${renderTab("usage", "Usage")}  ${theme.fg("dim", "/")}  ${renderTab("overrides", "Overrides")}  ${theme.fg("dim", "/")}  ${renderTab("about", "About")}`;
}

function formatFooter(activeTab: SettingsTab): string {
	if (activeTab === "usage") return "  Tab to switch sections · r refresh";
	if (activeTab === "about") return "  Tab to switch sections · g/c/d/i open links";
	return "  Tab to switch sections";
}

function withSettingsFooter(lines: string[], theme: Theme): string[] {
	const next = [...lines];
	for (let index = next.length - 1; index >= 0; index -= 1) {
		if (next[index]?.includes("Enter/Space")) {
			next[index] = theme.fg("dim", "  Enter/Space to change · Esc to cancel · Tab to switch sections");
			break;
		}
	}
	return next;
}

function formatUsageLines(theme: Theme, usageState: CodexUsageSnapshot | { error: string } | undefined, loading: boolean): string[] {
	if (loading && !usageState) return [theme.fg("dim", "  Loading Codex usage…")];
	if (!usageState) return [theme.fg("dim", "  Loading Codex usage…")];
	if ("error" in usageState) return [theme.fg("error", `  ${usageState.error}`), theme.fg("dim", "  Press r to retry.")];

	const rows = usageState.limits.map((limit) => {
		const primary = usageColumns(limit.primary);
		const secondary = usageColumns(limit.secondary);
		return [limit.limitName ?? limit.limitId, primary.bar, primary.percent, primary.reset, secondary.bar, secondary.percent, secondary.reset];
	});
	const headers = ["Limit", "5h", "", "Reset", "Weekly", "", "Reset"];
	const widths = columnWidths([headers, ...rows]);
	return [
		`  ${theme.bold(`Codex usage${usageState.planType ? ` · ${usageState.planType}` : ""}`)}${loading ? theme.fg("dim", "  refreshing…") : ""}`,
		"",
		formatUsageRow(headers.map((header) => theme.fg("dim", header)), widths),
		theme.fg("borderMuted", `  ${"─".repeat(widths.reduce((sum, width) => sum + width, 0) + (2 * (widths.length - 1)))}`),
		...rows.map((row) => formatUsageRow(row, widths)),
	];
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
	const percent = window.usedPercent === undefined ? undefined : Math.max(0, Math.min(100, window.usedPercent));
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
	switch (data) {
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
