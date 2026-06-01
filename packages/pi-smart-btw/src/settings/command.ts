import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatBtwSettings, readConfig, writeConfig } from "../config.js";
import { openBtwSettingsScreen } from "./ui.js";

const BTW_CONFIG_COMPLETIONS = ["config"] as const;

export function handleBtwConfigArg(
	ctx: ExtensionContext,
	arg: string,
	onSaved?: () => void,
): boolean {
	if (arg !== "config") return false;
	const initialConfig = readConfig();
	if (!ctx.hasUI) {
		ctx.ui.notify(formatBtwSettings(initialConfig), "info");
		return true;
	}
	void openBtwSettingsScreen(ctx, {
		initialConfig,
		onChange: (nextConfig) => {
			const result = writeConfig(nextConfig);
			if (!result.ok) {
				ctx.ui.notify(`Failed to save BTW settings: ${result.error}`, "error");
				return false;
			}
			onSaved?.();
			ctx.ui.notify(formatBtwSettings(nextConfig), "info");
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
