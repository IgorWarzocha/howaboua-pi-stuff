import {
	type ExtensionAPI,
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import {
	type ImagegenSettings,
	readImagegenSettings,
	writeImagegenSettings,
} from "./settings.js";

function items(settings: ImagegenSettings): SettingItem[] {
	const api = settings.api;
	const result: SettingItem[] = [
		{
			id: "access",
			label: "Access",
			currentValue: settings.access === "codex" ? "Codex OAuth" : "OpenAI API",
			values: ["Codex OAuth", "OpenAI API"],
			description:
				"Codex uses your current compatible route or Pi login. OpenAI API uses Pi's openai credentials and separate API billing. No automatic fallback.",
		},
	];
	if (settings.access === "codex") return result;
	const field = (
		id: string,
		label: string,
		value: string | number,
		values: readonly string[],
		description?: string,
	): SettingItem => ({
		id,
		label,
		currentValue: String(value),
		values: [...values],
		...(description ? { description } : {}),
	});
	result.push(
		field("model", "Model", api.model, [
			"gpt-image-2.6-flare",
			"gpt-image-2.6-sunburst",
		]),
		field("quality", "Quality", api.quality, [
			"auto",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]),
		field(
			"complexity",
			"Complexity",
			api.complexity,
			["low", "medium", "high"],
			"Planning effort. High is the API default; lower values favour speed.",
		),
	);
	return result;
}

async function openSettings(
	ctx: ExtensionContext,
	refresh: () => void,
): Promise<void> {
	if (!ctx.hasUI)
		throw new Error("/imagegen requires an interactive Pi session.");
	let settings = readImagegenSettings();
	await ctx.ui.custom<void>((tui, theme, _keys, done) => {
		let list: SettingsList;
		const createList = () =>
			new SettingsList(
				items(settings),
				10,
				getSettingsListTheme(),
				(id, value) => {
					const next = structuredClone(settings);
					if (id === "access")
						next.access = value === "OpenAI API" ? "openai" : "codex";
					else {
						// The visible list owns the finite values. Validate again before persistence.
						Object.assign(next.api, { [id]: value });
					}
					try {
						writeImagegenSettings(next);
						settings = next;
						refresh();
					} catch (error) {
						ctx.ui.notify(
							error instanceof Error ? error.message : String(error),
							"error",
						);
					}
					list = createList();
					list.selectItem(id);
					tui.requestRender();
				},
				() => done(undefined),
			);
		list = createList();
		return {
			render: (width: number) => [
				theme.bold("Imagegen"),
				...list.render(width),
			],
			invalidate: () => list.invalidate(),
			handleInput: (data: string) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

export function registerImagegenSettings(
	pi: ExtensionAPI,
	refresh: () => void,
): void {
	pi.registerCommand("imagegen", {
		description: "Image generation access and defaults",
		handler: async (_args, ctx) => {
			try {
				await openSettings(ctx, refresh);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});
}
