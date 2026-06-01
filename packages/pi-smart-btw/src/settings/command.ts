import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatBtwSettings, readConfig, writeConfig } from "../config.js";
import { resolveProviderModel } from "./models.js";
import {
	resolveShortcutChord,
	type ShortcutConfigField,
} from "./shortcut-editor.js";
import { openBtwSettingsScreen } from "./ui.js";

const BTW_CONFIG_COMPLETIONS = ["config"] as const;

export function handleBtwConfigArg(
	ctx: ExtensionContext,
	arg: string,
	onSaved?: () => void,
): boolean {
	if (arg !== "config") return false;
	const fileConfig = readConfig();
	const initialConfig = {
		...fileConfig,
		...resolveProviderModel(ctx, fileConfig.provider, fileConfig.modelId),
	};
	if (!ctx.hasUI) {
		ctx.ui.notify(formatBtwSettings(initialConfig), "info");
		return true;
	}
	void openBtwSettingsScreen(ctx, {
		initialConfig,
		onSave: (nextConfig) => {
			const resolved = {
				...nextConfig,
				...resolveProviderModel(ctx, nextConfig.provider, nextConfig.modelId),
			};
			for (const key of [
				"composeShortcut",
				"injectShortcut",
				"dismissShortcut",
				"foldShortcut",
				"unfoldShortcut",
				"previousShortcut",
				"nextShortcut",
			] as const) {
				resolved[key] = resolveShortcutChord(
					key as ShortcutConfigField,
					resolved[key],
				);
			}
			const result = writeConfig(resolved);
			if (!result.ok) {
				ctx.ui.notify(`Failed to save BTW settings: ${result.error}`, "error");
				return false;
			}
			onSaved?.();
			return true;
		},
	});
	return true;
}

export function btwArgumentCompletions(prefix: string) {
	const trimmed = prefix.trim().toLowerCase();
	return BTW_CONFIG_COMPLETIONS.filter((item) => item.startsWith(trimmed)).map(
		(value) => ({ label: value, value }),
	);
}
