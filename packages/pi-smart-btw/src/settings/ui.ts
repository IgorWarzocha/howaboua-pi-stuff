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
import {
	CHANGELOG_URL,
	DISCORD_URL,
	GITHUB_URL,
	ISSUE_URL,
	openExternalUrl,
} from "./links.js";
import { listModelOptions } from "./models.js";

export type BtwSettingsDraft = ReturnType<typeof readConfig>;

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
	const modelOptions = listModelOptions(ctx);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		let settingsList = createSettingsList(
			activeTab,
			draft,
			modelOptions,
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
				modelOptions,
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
					...(activeTab === "shortcuts" ? formatShortcutNotes(theme) : []),
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
	modelOptions: string[],
	options: BtwSettingsScreenOptions,
	onDraftChanged: (draft: BtwSettingsDraft) => void,
	done: (value?: void) => void,
	requestRender: () => void,
): SettingsList {
	let settingsList: SettingsList;
	settingsList = new SettingsList(
		buildItems(tab, draft, modelOptions),
		8,
		getSettingsListTheme(),
		(id, value) => {
			const nextDraft = applySettingChange(id, value, draft);
			const previousValue = buildItems(tab, draft, modelOptions).find(
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
	modelOptions: string[],
): SettingItem[] {
	if (tab === "about") return [];
	const valuesForModel = modelOptions.includes(draft.model)
		? modelOptions
		: [draft.model, ...modelOptions];
	if (tab === "general") {
		return [
			{
				id: "model",
				label: "Child model",
				currentValue: draft.model,
				values: valuesForModel,
			},
			{
				id: "thinking",
				label: "Thinking",
				currentValue: draft.thinking,
				values: [...THINKING_LEVELS],
			},
			{
				id: "command",
				label: "Pi command",
				currentValue: draft.command,
				values: uniqueValues([draft.command, "pi", "bun", "npx"]),
			},
		];
	}
	return [
		{
			id: "composeShortcut",
			label: "Compose",
			currentValue: draft.composeShortcut,
			values: uniqueValues([draft.composeShortcut, "alt+z"]),
		},
		{
			id: "injectShortcut",
			label: "Inject & clear",
			currentValue: draft.injectShortcut,
			values: uniqueValues([draft.injectShortcut, "alt+c"]),
		},
		{
			id: "dismissShortcut",
			label: "Clear slot",
			currentValue: draft.dismissShortcut,
			values: uniqueValues([draft.dismissShortcut, "alt+x"]),
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
): BtwSettingsDraft {
	const next = { ...draft };
	if (id === "model") next.model = value;
	if (
		id === "thinking" &&
		(THINKING_LEVELS as readonly string[]).includes(value)
	)
		next.thinking = value as BtwSettingsDraft["thinking"];
	if (id === "command") next.command = value.trim() || draft.command;
	if (id === "composeShortcut") next.composeShortcut = value;
	if (id === "injectShortcut") next.injectShortcut = value;
	if (id === "dismissShortcut") next.dismissShortcut = value;
	return next;
}

function formatTabs(activeTab: SettingsTab, theme: Theme): string {
	const renderTab = (tab: SettingsTab, label: string) =>
		activeTab === tab ? theme.bold(label) : theme.fg("dim", label);
	return `  ${renderTab("general", "General")}  ${theme.fg("dim", "/")}  ${renderTab("shortcuts", "Shortcuts")}  ${theme.fg("dim", "/")}  ${renderTab("about", "About")}`;
}

function formatFooter(activeTab: SettingsTab): string {
	if (activeTab === "about")
		return "  Tab to switch sections · g/c/d/i open links";
	return "  Tab to switch sections · new child sessions pick up model/thinking";
}

function formatShortcutNotes(theme: Theme): string[] {
	return [
		theme.fg(
			"dim",
			"  Slot fold/switch: alt+j/k fold, alt+h/l prev/next, alt+1..9",
		),
	];
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

function getLinkTarget(
	data: string,
): { url: string; message: string } | undefined {
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
