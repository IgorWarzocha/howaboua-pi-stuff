import {
	type ExtensionContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type SettingItem,
	SettingsList,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { THINKING_LEVELS } from "../config.js";
import { DEFAULT_SHORTCUTS } from "../constants.js";
import type { ResolvedBtwConfig } from "../types.js";
import {
	CHANGELOG_URL,
	GITHUB_URL,
	ISSUE_URL,
	openExternalUrl,
} from "./links.js";
import {
	ensureProviderModel,
	listModelIdsForProvider,
	listProviders,
} from "./models.js";

export type BtwSettingsDraft = ResolvedBtwConfig;

export interface BtwSettingsScreenOptions {
	initialConfig: BtwSettingsDraft;
	onChange: (nextConfig: BtwSettingsDraft) => boolean;
	initialTab?: SettingsTab | undefined;
}

type SettingsTab = "general" | "shortcuts" | "about";

const TAB_ORDER: readonly SettingsTab[] = ["general", "shortcuts", "about"];

export async function openBtwSettingsScreen(
	ctx: ExtensionContext,
	options: BtwSettingsScreenOptions,
): Promise<void> {
	let draft = { ...options.initialConfig };
	let activeTab: SettingsTab = options.initialTab ?? "general";
	const providers = listProviders(ctx);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		let settingsList = createSettingsList(
			activeTab,
			draft,
			ctx,
			providers,
			options,
			(nextDraft) => {
				draft = nextDraft;
			},
			done,
			() => tui.requestRender(),
		);

		const switchTab = () => {
			const currentIndex = TAB_ORDER.indexOf(activeTab);
			activeTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length] ?? "general";
			settingsList = createSettingsList(
				activeTab,
				draft,
				ctx,
				providers,
				options,
				(nextDraft) => {
					draft = nextDraft;
				},
				done,
				() => tui.requestRender(),
			);
			tui.requestRender();
		};

		return {
			render: (width: number) =>
				[
					rule(width, theme, "accent"),
					formatTabs(activeTab, theme),
					rule(width, theme, "borderMuted"),
					...(activeTab === "about" ? formatLinks(theme) : []),
					"",
					...(activeTab === "about" ? [] : settingsList.render(width)),
					rule(width, theme, "accent"),
					theme.fg("dim", formatFooter(activeTab)),
				].map((line) => truncateToWidth(line, width, "")),
			invalidate: () => settingsList.invalidate(),
			handleInput: (data: string) => {
				if (data === "\t") {
					switchTab();
					return;
				}
				if (activeTab === "about" && handleLinkKey(data, ctx)) return;
				settingsList.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}

function rule(
	width: number,
	theme: Theme,
	color: "accent" | "borderMuted",
): string {
	return theme.fg(color, "─".repeat(Math.max(0, width)));
}

function createSettingsList(
	tab: SettingsTab,
	draft: BtwSettingsDraft,
	ctx: ExtensionContext,
	providers: string[],
	options: BtwSettingsScreenOptions,
	onDraftChanged: (draft: BtwSettingsDraft) => void,
	done: (value?: void) => void,
	requestRender: () => void,
): SettingsList {
	let settingsList: SettingsList;
	settingsList = new SettingsList(
		buildItems(tab, draft, ctx, providers),
		8,
		getSettingsListTheme(),
		(id, value) => {
			const nextDraft = applySettingChange(id, value, draft, ctx);
			const previousValue = buildItems(tab, draft, ctx, providers).find(
				(item) => item.id === id,
			)?.currentValue;
			if (options.onChange(nextDraft)) {
				onDraftChanged(nextDraft);
				draft = nextDraft;
			} else if (previousValue !== undefined) {
				settingsList.updateValue(id, previousValue);
			}
			requestRender();
		},
		() => done(undefined),
	);
	return settingsList;
}

function buildItems(
	tab: SettingsTab,
	draft: BtwSettingsDraft,
	ctx: ExtensionContext,
	providers: string[],
): SettingItem[] {
	if (tab === "about") return [];
	if (tab === "general") {
		const providerValues = providers.includes(draft.provider)
			? providers
			: [draft.provider, ...providers];
		const modelIds = listModelIdsForProvider(ctx, draft.provider);
		const modelValues = modelIds.includes(draft.modelId)
			? modelIds
			: [draft.modelId, ...modelIds];
		return [
			{
				id: "provider",
				label: "Provider",
				currentValue: draft.provider,
				values: providerValues,
			},
			{
				id: "modelId",
				label: "Model",
				currentValue: draft.modelId,
				values: modelValues,
			},
			{
				id: "thinking",
				label: "Thinking",
				currentValue: draft.thinking,
				values: [...THINKING_LEVELS],
			},
		];
	}
	return [
		{
			id: "composeShortcut",
			label: "Compose",
			currentValue: draft.composeShortcut,
			values: uniqueValues([draft.composeShortcut, DEFAULT_SHORTCUTS.compose]),
		},
		{
			id: "injectShortcut",
			label: "Inject & clear",
			currentValue: draft.injectShortcut,
			values: uniqueValues([draft.injectShortcut, DEFAULT_SHORTCUTS.inject]),
		},
		{
			id: "dismissShortcut",
			label: "Clear slot",
			currentValue: draft.dismissShortcut,
			values: uniqueValues([draft.dismissShortcut, DEFAULT_SHORTCUTS.clear]),
		},
		{
			id: "foldShortcut",
			label: "Fold",
			currentValue: draft.foldShortcut,
			values: uniqueValues([draft.foldShortcut, DEFAULT_SHORTCUTS.fold]),
		},
		{
			id: "unfoldShortcut",
			label: "Unfold",
			currentValue: draft.unfoldShortcut,
			values: uniqueValues([draft.unfoldShortcut, DEFAULT_SHORTCUTS.unfold]),
		},
		{
			id: "previousShortcut",
			label: "Previous slot",
			currentValue: draft.previousShortcut,
			values: uniqueValues([
				draft.previousShortcut,
				DEFAULT_SHORTCUTS.previous,
			]),
		},
		{
			id: "nextShortcut",
			label: "Next slot",
			currentValue: draft.nextShortcut,
			values: uniqueValues([draft.nextShortcut, DEFAULT_SHORTCUTS.next]),
		},
	];
}

function uniqueValues(values: string[]) {
	return [...new Set(values.filter((v) => v.trim()))];
}

function applySettingChange(
	id: string,
	value: string,
	draft: BtwSettingsDraft,
	ctx: ExtensionContext,
): BtwSettingsDraft {
	const next = { ...draft };
	if (id === "provider") {
		next.provider = value;
		const ids = listModelIdsForProvider(ctx, value);
		if (!ids.includes(next.modelId)) next.modelId = ids[0] ?? next.modelId;
		return {
			...next,
			...ensureProviderModel(ctx, next.provider, next.modelId),
		};
	}
	if (id === "modelId") next.modelId = value;
	if (
		id === "thinking" &&
		(THINKING_LEVELS as readonly string[]).includes(value)
	)
		next.thinking = value as BtwSettingsDraft["thinking"];
	if (id === "composeShortcut") next.composeShortcut = value;
	if (id === "injectShortcut") next.injectShortcut = value;
	if (id === "dismissShortcut") next.dismissShortcut = value;
	if (id === "foldShortcut") next.foldShortcut = value;
	if (id === "unfoldShortcut") next.unfoldShortcut = value;
	if (id === "previousShortcut") next.previousShortcut = value;
	if (id === "nextShortcut") next.nextShortcut = value;
	const fixed = ensureProviderModel(ctx, next.provider, next.modelId);
	return { ...next, ...fixed };
}

function formatTabs(activeTab: SettingsTab, theme: Theme): string {
	const renderTab = (tab: SettingsTab, label: string) =>
		activeTab === tab ? theme.bold(label) : theme.fg("dim", label);
	return `  ${renderTab("general", "General")}  ${theme.fg("dim", "/")}  ${renderTab("shortcuts", "Shortcuts")}  ${theme.fg("dim", "/")}  ${renderTab("about", "About")}`;
}

function formatFooter(activeTab: SettingsTab): string {
	if (activeTab === "about") return "  Tab · g github · c changelog · i issue";
	return "  Tab to switch · new children use provider/model/thinking";
}

function formatLinks(theme: Theme): string[] {
	return [
		`${theme.bold("g")} github  ${theme.fg("dim", GITHUB_URL)}`,
		`${theme.bold("c")} changes ${theme.fg("dim", CHANGELOG_URL)}`,
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

function getLinkTarget(
	data: string,
): { url: string; message: string } | undefined {
	switch (data) {
		case "g":
			return { url: GITHUB_URL, message: "Opened GitHub" };
		case "c":
			return { url: CHANGELOG_URL, message: "Opened changelog" };
		case "i":
			return { url: ISSUE_URL, message: "Opened issue form" };
		default:
			return undefined;
	}
}
