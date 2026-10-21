import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfig, type SuggestionConfig, writeConfig } from "./config.js";

export async function showSettings(
	ctx: ExtensionContext,
	onChange: (config: SuggestionConfig) => void,
): Promise<void> {
	const ui = ctx.ui;
	if (ctx.mode !== "tui") {
		ui.notify(
			"Open /suggestions in Pi's terminal UI to change suggestion settings.",
			"warning",
		);
		return;
	}
	const sessionId = ctx.sessionManager.getSessionId();
	const leafId = ctx.sessionManager.getLeafId();
	const signal = ctx.signal;
	const options = signal ? { signal } : undefined;
	const current = () =>
		!signal?.aborted &&
		!ctx.signal?.aborted &&
		ctx.sessionManager.getSessionId() === sessionId &&
		ctx.sessionManager.getLeafId() === leafId;

	// Pi's public selector has no filtering or scrolling; keep each page small and offer explicit search.
	async function searchable<T>(
		title: string,
		entries: readonly T[],
		label: (entry: T) => string,
	): Promise<T | undefined> {
		let query = "";
		let page = 0;
		while (current()) {
			const filtered = entries.filter((entry) =>
				label(entry).toLowerCase().includes(query.toLowerCase()),
			);
			const visible = filtered.slice(page * 10, (page + 1) * 10);
			const choices = visible.map((entry) => `  ${label(entry)}`);
			choices.push("Search…");
			if (query) choices.push("Clear search");
			if (page > 0) choices.push("Previous page");
			if ((page + 1) * 10 < filtered.length) choices.push("Next page");
			const selection = await ui.select(
				`${title}${query ? ` — ${query}` : ""} (${filtered.length} matches)`,
				choices,
				options,
			);
			if (!current() || selection === undefined) return undefined;
			if (selection === "Search…") {
				const search = await ui.input(
					`Search ${title.toLowerCase()}`,
					query,
					options,
				);
				if (!current() || search === undefined) return undefined;
				query = search.trim();
				page = 0;
			} else if (selection === "Clear search") {
				query = "";
				page = 0;
			} else if (selection === "Previous page") {
				page--;
			} else if (selection === "Next page") {
				page++;
			} else {
				return visible.find((entry) => `  ${label(entry)}` === selection);
			}
		}
		return undefined;
	}

	async function chooseModel(): Promise<SuggestionConfig["model"]> {
		const models = ctx.modelRegistry.getAvailable();
		if (models.length === 0) {
			ui.notify(
				"No authenticated models are available. Configure a provider in Pi, then reopen /suggestions.",
				"warning",
			);
			return undefined;
		}
		const providers = [
			...new Set(models.map((model) => model.provider)),
		].sort();
		const provider = await searchable("Provider", providers, (entry) => entry);
		if (!current() || provider === undefined) return undefined;
		const model = await searchable(
			"Model",
			models
				.filter((entry) => entry.provider === provider)
				.sort((a, b) => a.id.localeCompare(b.id)),
			(entry) =>
				entry.name === entry.id ? entry.id : `${entry.id} — ${entry.name}`,
		);
		if (!current() || model === undefined) return undefined;
		const levels = getSupportedThinkingLevels(model);
		const reasoning = levels.includes("low") ? "low" : levels[0];
		if (reasoning === undefined) {
			ui.notify(
				"This model has no supported reasoning levels. Choose another model in /suggestions.",
				"error",
			);
			return undefined;
		}
		return { provider: model.provider, id: model.id, reasoning };
	}

	async function chooseReasoning(
		model: NonNullable<SuggestionConfig["model"]>,
	): Promise<ModelThinkingLevel | undefined> {
		const available = ctx.modelRegistry
			.getAvailable()
			.find(
				(entry) => entry.provider === model.provider && entry.id === model.id,
			);
		if (!available) {
			ui.notify(
				"The suggestion model is unavailable. Choose an available model in /suggestions.",
				"warning",
			);
			return undefined;
		}
		const levels = getSupportedThinkingLevels(available);
		const selection = await ui.select(
			`Reasoning — current: ${model.reasoning}`,
			levels,
			options,
		);
		return current() ? levels.find((level) => level === selection) : undefined;
	}

	try {
		let config = readConfig();
		while (current()) {
			const selection = await ui.select(
				"Suggestions\nSuggestions use the selected model's quota and may incur API charges.",
				[
					`On/Off: ${config.enabled ? "On" : "Off"}`,
					`Model: ${config.model ? `${config.model.provider}/${config.model.id}` : "Not chosen"}`,
					`Reasoning: ${config.model?.reasoning ?? "Choose a model first"}`,
					"Done",
				],
				options,
			);
			if (!current() || selection === undefined || selection === "Done") return;
			let next: SuggestionConfig | undefined;
			if (selection.startsWith("On/Off:")) {
				const state = await ui.select(
					"Suggestions — On/Off",
					["On", "Off"],
					options,
				);
				if (!current()) return;
				if (state === "Off") next = { ...config, enabled: false };
				if (state === "On") {
					const chosen = config.model;
					let model = chosen;
					const available =
						chosen &&
						ctx.modelRegistry
							.getAvailable()
							.find(
								(entry) =>
									entry.provider === chosen.provider && entry.id === chosen.id,
							);
					if (!available) model = await chooseModel();
					else if (
						model &&
						!getSupportedThinkingLevels(available).includes(model.reasoning)
					) {
						const reasoning = await chooseReasoning(model);
						model =
							reasoning === undefined ? undefined : { ...model, reasoning };
					}
					if (model) next = { enabled: true, model };
				}
			} else if (selection.startsWith("Model:")) {
				const model = await chooseModel();
				if (model) next = { ...config, model };
			} else if (selection.startsWith("Reasoning:")) {
				if (!config.model)
					ui.notify("Choose a suggestion model first.", "info");
				else {
					const reasoning = await chooseReasoning(config.model);
					if (reasoning !== undefined)
						next = { ...config, model: { ...config.model, reasoning } };
				}
			}
			// Never persist a choice returned after cancellation or session/tree navigation.
			if (!current()) return;
			if (next) {
				writeConfig(next);
				config = next;
				onChange(config);
			}
		}
	} catch (error) {
		ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}
