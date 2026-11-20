import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	SettingsList,
	Spacer,
	Text,
	type Component,
} from "@earendil-works/pi-tui";
import { openAICodexProviderModels } from "../../providers/openai-codex/model-catalog.ts";
import { TextSettingSubmenu } from "./config-items-shared.ts";
import { writeContextWindowOverride } from "./context-window-store.ts";

const format = (tokens: number) => `${tokens.toLocaleString("en-US")} tokens`;

class PickerPanel extends Container {
	list?: SettingsList;
	submenuOpen = false;
	override render(width: number): readonly string[] {
		return this.submenuOpen && this.list
			? this.list.render(width)
			: super.render(width);
	}
	handleInput(data: string): void {
		this.list?.handleInput(data);
	}
}

export function contextWindowPicker(
	ctx: ExtensionContext,
	theme: Theme,
	setModel: ExtensionAPI["setModel"],
	waitForIdle: () => Promise<void>,
	close: () => void,
): Component {
	const catalog = openAICodexProviderModels();
	const models = ctx.modelRegistry
		.getAll()
		.filter(({ provider }) => provider === "openai-codex")
		.map((model) =>
			ctx.model?.provider === model.provider && ctx.model.id === model.id
				? ctx.model
				: model,
		);
	const panel = new PickerPanel();
	panel.addChild(
		new Text(
			theme.bold(theme.fg("accent", "Context windows (openai-codex)")),
			2,
			0,
		),
	);
	panel.addChild(new Spacer(1));
	panel.addChild(
		new Text(
			theme.fg("dim", "For proxy or renamed providers, edit Pi’s models.json."),
			2,
			0,
		),
	);
	panel.addChild(new Spacer(1));
	const list = new SettingsList(
		models.map((model) => ({
			id: model.id,
			label: model.name,
			currentValue: format(model.contextWindow),
			description: model.id,
			submenu: (_value: string, back: () => void) => {
				panel.submenuOpen = true;
				const defaultSize = catalog.find(
					({ id }) => id === model.id,
				)?.contextWindow;
				const effectiveModel = () =>
					ctx.model?.provider === model.provider && ctx.model.id === model.id
						? ctx.model
						: (ctx.modelRegistry.find(model.provider, model.id) ?? model);
				const modelPanel = new PickerPanel();
				const summary = new Text("", 2, 0);
				const updateSummary = () => {
					const currentSize = effectiveModel().contextWindow;
					summary.setText(
						theme.bold(theme.fg("accent", model.name)) +
							`\nCurrent: ${format(currentSize)}` +
							(defaultSize && defaultSize !== currentSize
								? `\nDefault: ${format(defaultSize)}`
								: ""),
					);
				};
				updateSummary();
				let saving = false;
				const save = async (tokens: number | undefined) => {
					if (saving) return false;
					saving = true;
					try {
						if (ctx.modelRegistry.getError())
							throw new Error(
								"Pi reports an invalid model configuration. Fix models.json before saving.",
							);
						writeContextWindowOverride(model.id, tokens);
						if (!ctx.isIdle())
							ctx.ui.notify(
								"Context window saved; applies when the current run settles.",
								"info",
							);
						await waitForIdle();
						await ctx.modelRegistry.refresh();
						if (ctx.modelRegistry.getError())
							throw new Error(
								"Context window saved, but model configuration could not reload. Fix models.json and retry.",
							);
						const refreshed = ctx.modelRegistry.find(model.provider, model.id);
						if (!refreshed)
							throw new Error(
								"Context window saved, but the model is unavailable. Check models.json and retry.",
							);
						if (tokens !== undefined && refreshed.contextWindow !== tokens)
							throw new Error(
								"Context window saved, but another model definition takes precedence. Edit models.json and retry.",
							);
						if (
							ctx.model?.provider === model.provider &&
							ctx.model.id === model.id &&
							!(await setModel(refreshed))
						)
							throw new Error(
								"Context window saved, but could not apply to the active model. Sign in and retry.",
							);
						list.updateValue(model.id, format(refreshed.contextWindow));
						updateSummary();
						ctx.ui.notify("Context window saved and applied.", "info");
						return true;
					} catch (error) {
						ctx.ui.notify(
							error instanceof Error
								? error.message
								: "Could not save context window",
							"error",
						);
						return false;
					} finally {
						saving = false;
					}
				};
				const presets = [272_000, 500_000, 872_000];
				modelPanel.addChild(summary);
				modelPanel.addChild(new Spacer(1));
				modelPanel.list = new SettingsList(
					[
						...presets.map((tokens) => ({
							id: String(tokens),
							label: format(tokens),
							currentValue: "",
							values: [""],
						})),
						{
							id: "custom",
							label: "Custom",
							currentValue: "",
							submenu: (_current, finish) => {
								modelPanel.submenuOpen = true;
								const done = () => {
									modelPanel.submenuOpen = false;
									finish();
								};
								let open = true;
								const input = new TextSettingSubmenu(
									"Custom context window",
									"Enter a positive whole token count.",
									String(effectiveModel().contextWindow),
									// oxlint-disable-next-line typescript/no-misused-promises -- save reports persistence/application failures to the UI.
									async (value) => {
										if (
											!/^[0-9]+$/.test(value.trim()) ||
											!Number.isSafeInteger(Number(value)) ||
											Number(value) <= 0
										) {
											ctx.ui.notify(
												"Enter a positive whole token count.",
												"error",
											);
											return;
										}
										if ((await save(Number(value))) && open) {
											open = false;
											done();
										}
									},
									() => {
										open = false;
										done();
									},
									theme,
								);
								input.focused = true;
								return input;
							},
						},
						{
							id: "reset",
							label: "Reset to default",
							currentValue: "",
							values: [""],
						},
					],
					6,
					getSettingsListTheme(),
					(id) => {
						void save(id === "reset" ? undefined : Number(id));
						modelPanel.list?.updateValue(id, "");
					},
					() => {
						panel.submenuOpen = false;
						back();
					},
				);
				modelPanel.addChild(modelPanel.list);
				return modelPanel;
			},
		})),
		8,
		getSettingsListTheme(),
		() => {},
		close,
	);
	panel.list = list;
	panel.addChild(list);
	return panel;
}
