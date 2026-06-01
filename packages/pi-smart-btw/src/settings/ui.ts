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
import { readConfig, THINKING_LEVELS } from "../config.js";
import type { ResolvedBtwConfig } from "../types.js";
import { editorCommand, openConfigInExternalEditor } from "./config-editor.js";
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

function replaceSettingsHint(lines: string[]): string[] {
	return lines.map((line) =>
		line.replace(/Esc to cancel/gi, "Esc close (saves)"),
	);
}

function mergeDraftForSave(
	draft: BtwSettingsDraft,
	ctx: ExtensionContext,
): BtwSettingsDraft {
	const fromDisk = readConfig();
	return {
		...fromDisk,
		thinking: draft.thinking,
		...resolveProviderModel(ctx, draft.provider, draft.modelId),
	};
}

export type BtwSettingsDraft = ResolvedBtwConfig;

export interface BtwSettingsScreenOptions {
	initialConfig: BtwSettingsDraft;
	onSave: (nextConfig: BtwSettingsDraft) => boolean;
	initialTab?: SettingsTab | undefined;
}

type SettingsTab = "general" | "about";

const TAB_ORDER: readonly SettingsTab[] = ["general", "about"];

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

		const reloadDraftFromDisk = () => {
			const file = readConfig();
			draft = {
				...file,
				...resolveProviderModel(ctx, file.provider, file.modelId),
			};
		};

		let focusedId = "provider";

		const saveAndClose = () => {
			const toSave = mergeDraftForSave(draft, ctx);
			if (!options.onSave(toSave)) return;
			done(undefined);
		};

		const setListFocus = (
			list: SettingsList,
			items: SettingItem[],
			id: string,
		) => {
			const index = items.findIndex((item) => item.id === id);
			const listAny = list as unknown as { selectedIndex: number };
			listAny.selectedIndex =
				index >= 0
					? index
					: Math.min(listAny.selectedIndex, Math.max(0, items.length - 1));
		};

		const onSettingChange = (id: string, value: string) => {
			focusedId = id;
			if (id === "editShortcuts") {
				void runEditConfig();
				return;
			}
			const nextDraft = applySettingChange(id, value, draft, ctx);
			const previousValue = buildItems(activeTab, draft, ctx, providers).find(
				(item) => item.id === id,
			)?.currentValue;
			const applied = JSON.stringify(nextDraft) !== JSON.stringify(draft);
			if (!applied && previousValue !== undefined) {
				settingsList.updateValue(id, previousValue);
			} else if (applied) {
				draft = nextDraft;
				mountList(focusedId);
			}
			tui.requestRender();
		};

		const mountList = (focusId = focusedId) => {
			const items = buildItems(activeTab, draft, ctx, providers);
			settingsList = new SettingsList(
				items,
				8,
				getSettingsListTheme(),
				onSettingChange,
				saveAndClose,
			);
			setListFocus(settingsList, items, focusId);
		};

		const runEditConfig = async () => {
			const toSave = mergeDraftForSave(draft, ctx);
			if (!options.onSave(toSave)) {
				ctx.ui.notify(
					"Could not save settings before opening editor",
					"warning",
				);
				return;
			}
			const result = await openConfigInExternalEditor(
				() => tui.stop(),
				() => tui.start(),
				(full) => tui.requestRender(full),
			);
			if (!result.ok) {
				ctx.ui.notify(result.error, "warning");
				return;
			}
			reloadDraftFromDisk();
			mountList(focusedId);
			tui.requestRender();
		};

		mountList();

		const switchTab = () => {
			const currentIndex = TAB_ORDER.indexOf(activeTab);
			activeTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length] ?? "general";
			focusedId = "provider";
			mountList(focusedId);
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
					...(activeTab === "about"
						? []
						: replaceSettingsHint(settingsList.render(width))),
					rule(width, theme, "accent"),
					...(activeTab === "about"
						? [
								theme.fg(
									"dim",
									"  Tab · g github · c changelog · i issue · Esc close (saves)",
								),
							]
						: []),
				].map((line) => truncateToWidth(line, width, "")),
			invalidate: () => settingsList.invalidate(),
			handleInput: (data: string) => {
				if (data === "\t") {
					switchTab();
					return;
				}
				if (activeTab === "about") {
					if (handleLinkKey(data, ctx)) tui.requestRender();
					return;
				}
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

function buildItems(
	tab: SettingsTab,
	draft: BtwSettingsDraft,
	ctx: ExtensionContext,
	providers: string[],
): SettingItem[] {
	if (tab === "about") return [];
	const resolved = resolveProviderModel(ctx, draft.provider, draft.modelId);
	const providerValues = providers.length > 0 ? providers : [resolved.provider];
	const modelIds = listModelIdsForProvider(ctx, resolved.provider);
	const modelValues = modelIds.length > 0 ? modelIds : [resolved.modelId];
	const modelCurrent =
		modelValues.find((id) => id === resolved.modelId) ??
		modelValues[0] ??
		resolved.modelId;
	const thinking =
		draft.thinking &&
		(THINKING_LEVELS as readonly string[]).includes(draft.thinking)
			? draft.thinking
			: "low";
	const editorReady = !!editorCommand();
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
			currentValue: thinking,
			values: [...THINKING_LEVELS],
		},
		{
			id: "editShortcuts",
			label: "Edit shortcuts",
			currentValue: editorReady
				? "Opens in default editor (please /reload)"
				: "Set $EDITOR",
			values: editorReady ? ["Open"] : ["Unavailable"],
		},
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
	return { ...next, ...resolveProviderModel(ctx, next.provider, next.modelId) };
}

function formatTabs(activeTab: SettingsTab, theme: Theme): string {
	const renderTab = (tab: SettingsTab, label: string) =>
		activeTab === tab ? theme.bold(label) : theme.fg("dim", label);
	return `  ${renderTab("general", "General")}  ${theme.fg("dim", "/")}  ${renderTab("about", "About")}`;
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
