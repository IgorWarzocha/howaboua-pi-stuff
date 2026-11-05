import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import {
	getCodexConversionConfigPath,
	getProjectCodexConversionConfigPath,
	hasFolderCodexConversionConfig,
	readLayeredCodexConversionConfig,
	writeCodexConversionConfig,
} from "../../adapter/activation/config-store.ts";
import type { LanVoiceSettings } from "./settings-contract.ts";
import {
	createVoiceSettings,
	type VoiceSettingsDependencies,
} from "./settings-core.ts";
export function createLanVoiceSettings(
	ctx: ExtensionContext,
	getConfig: () => CodexConversionConfig,
	hasWebSearch?: () => boolean,
): LanVoiceSettings {
	const folderScope = () =>
		hasFolderCodexConversionConfig(ctx.cwd, ctx.isProjectTrusted());
	const readConfig = () =>
		readLayeredCodexConversionConfig({
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		});
	const scope = () => (folderScope() ? "This project" : "Global");
	const saveVoice = (
		patch: Parameters<VoiceSettingsDependencies["saveVoice"]>[0],
	) => {
		const current = readConfig();
		const folder = folderScope();
		const result = writeCodexConversionConfig(
			{ ...current, voice: { ...current.voice, ...patch } },
			folder
				? getProjectCodexConversionConfigPath(ctx.cwd)
				: getCodexConversionConfigPath(),
			folder,
		);
		if (!result.ok)
			throw new Error(
				"Could not save voice settings; check the config file permissions and retry",
			);
	};
	const models = () =>
		ctx.modelRegistry
			.getAvailable()
			.filter((model) => model.input.includes("text"))
			.map((model) => ({ provider: model.provider, modelId: model.id }));
	return createVoiceSettings({
		readConfig,
		getConfig,
		saveVoice,
		models,
		scope,
		hasWebSearch,
	});
}
