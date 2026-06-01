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
import type { ResolvedBtwConfig } from "../types.js";
import {
	CHANGELOG_URL,
	GITHUB_URL,
	ISSUE_URL,
	openExternalUrl,
} from "./links.js";
import {
	isRegistryPair,
	listModelIdsForProvider,
	listProviders,
	resolveProviderModel,
} from "./models.js";
import {
	createShortcutCaptureSubmenu,
	defaultShortcut,
	isValidChord,
	SHORTCUT_CONFIG_KEYS,
} from "./shortcut-editor.js";

export type BtwSettingsDraft = ResolvedBtwConfig;

export interface BtwSettingsScreenOptions {
	initialConfig: BtwSettingsDraft;
	onSave: (nextConfig: BtwSettingsDraft) => boolean;
	initialTab?: SettingsTab | undefined;
}

type SettingsTab = "general" | "shortcuts" | "about";

const TAB_ORDER: readonly SettingsTab[] = ["general", "shortcuts", "about"];

export async function openBtwSettingsScreen(
	ctx: ExtensionContext,
	options: BtwSettingsScreenOptions,
): Promise<void> {
	let draft = {
		...options.initialConfig,
		...resolveProviderModel(
			ctx,
			options.initialConfig.provider,
			options.initialConfig.modelId,
		),
	};
	let activeTab: SettingsTab = options.initialTab ?? "general";
	const providers = listProviders(ctx);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		let settingsList: SettingsList;

		const saveAndClose = () => {
			draft = {
				...draft,
				...resolveProviderModel(ctx, draft.provider, draft.modelId),
			};
			if (!options.onSave(draft)) return;
			done(undefined);
		};

		const refreshList = () => {
			settingsList = createSettingsList(
				activeTab,
				draft,
				ctx,
				providers,
				(nextDraft) => {
					draft = nextDraft;
					refreshList();
				},
				saveAndClose,
				() => tui.requestRender(),
			);
		};

		refreshList();

		const switchTab = () => {
			const currentIndex = TAB_ORDER.indexOf(activeTab);
			activeTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length] ?? "general";
			refreshList();
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
	onDraftChanged: (draft: BtwSettingsDraft) => void,
	onClose: () => void,
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
			const applied = JSON.stringify(nextDraft) !== JSON.stringify(draft);
			if (!applied && previousValue !== undefined) {
				settingsList.updateValue(id, previousValue);
			} else if (applied) {
				onDraftChanged(nextDraft);
			}
			requestRender();
		},
		onClose,
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
		const resolved = resolveProviderModel(ctx, draft.provider, draft.modelId);
		const providerValues =
			providers.length > 0 ? providers : [resolved.provider];
		const modelIds = listModelIdsForProvider(ctx, resolved.provider);
		const modelValues = modelIds.length > 0 ? modelIds : [resolved.modelId];
		const modelCurrent = modelValues.includes(resolved.modelId)
			? resolved.modelId
			: modelValues[0]!;
		return [
			{
				id: "provider",
				label: "Provider",
				currentValue: resolved.provider,
				values: providerValues,
			},
			{
				id: "modelId",
				label: "Model",
				currentValue: modelCurrent,
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
	const shortcutItem = (
		id: keyof Pick<
			BtwSettingsDraft,
			| "composeShortcut"
			| "injectShortcut"
			| "dismissShortcut"
			| "foldShortcut"
			| "unfoldShortcut"
			| "previousShortcut"
			| "nextShortcut"
		>,
		label: string,
	): SettingItem => ({
		id,
		label,
		currentValue: draft[id] ?? defaultShortcut(SHORTCUT_CONFIG_KEYS[id]),
		description: "Space to record a new chord (Enter cycles)",
		submenu: (current, done) =>
			createShortcutCaptureSubmenu(current, (value: string | undefined) =>
				done(value),
			),
	});
	return [
		shortcutItem("composeShortcut", "Compose"),
		shortcutItem("injectShortcut", "Inject & clear"),
		shortcutItem("dismissShortcut", "Clear slot"),
		shortcutItem("foldShortcut", "Fold widget"),
		shortcutItem("unfoldShortcut", "Unfold widget"),
		shortcutItem("previousShortcut", "Previous slot"),
		shortcutItem("nextShortcut", "Next slot"),
	];
}

function applySettingChange(
	id: string,
	value: string,
	draft: BtwSettingsDraft,
	ctx: ExtensionContext,
): BtwSettingsDraft {
	const providers = listProviders(ctx);
	const next = { ...draft };
	if (id === "provider") {
		if (!providers.includes(value)) return draft;
		next.provider = value;
		const ids = listModelIdsForProvider(ctx, value);
		next.modelId = ids[0] ?? next.modelId;
		return {
			...next,
			...resolveProviderModel(ctx, next.provider, next.modelId),
		};
	}
	if (id === "modelId") {
		if (!isRegistryPair(ctx, next.provider, value)) return draft;
		next.modelId = value;
	}
	if (
		id === "thinking" &&
		(THINKING_LEVELS as readonly string[]).includes(value)
	)
		next.thinking = value as BtwSettingsDraft["thinking"];
	if (id === "composeShortcut" && isValidChord(value))
		next.composeShortcut = value;
	if (id === "injectShortcut" && isValidChord(value))
		next.injectShortcut = value;
	if (id === "dismissShortcut" && isValidChord(value))
		next.dismissShortcut = value;
	if (id === "foldShortcut" && isValidChord(value)) next.foldShortcut = value;
	if (id === "unfoldShortcut" && isValidChord(value))
		next.unfoldShortcut = value;
	if (id === "previousShortcut" && isValidChord(value))
		next.previousShortcut = value;
	if (id === "nextShortcut" && isValidChord(value)) next.nextShortcut = value;
	return resolveProviderModel(ctx, next.provider, next.modelId) as typeof next;
}

function formatTabs(activeTab: SettingsTab, theme: Theme): string {
	const renderTab = (tab: SettingsTab, label: string) =>
		activeTab === tab ? theme.bold(label) : theme.fg("dim", label);
	return `  ${renderTab("general", "General")}  ${theme.fg("dim", "/")}  ${renderTab("shortcuts", "Shortcuts")}  ${theme.fg("dim", "/")}  ${renderTab("about", "About")}`;
}

function formatFooter(activeTab: SettingsTab): string {
	if (activeTab === "about") return "  Tab · g github · c changelog · i issue";
	return "  Tab · Enter/Space cycle · Shortcuts: Space record · Esc save & close";
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
