import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../../config.ts";
import {
	getGippityControlConfigPath,
	readGippityControlConfig,
	writeGippityControlConfig,
} from "../../config-store.ts";

export { LanVoiceSettingsError } from "./settings-core.ts";

import {
	createVoiceSettings,
	type VoiceSettingsDependencies,
} from "./settings-core.ts";
export function createLanVoiceSettings(
	ctx: ExtensionContext,
	getConfig: () => GippityControlConfig,
	hasWebSearch?: () => boolean,
) {
	const readConfig = () => readGippityControlConfig();
	const scope = () => "Global";
	const saveVoice = (
		patch: Parameters<VoiceSettingsDependencies["saveVoice"]>[0],
	) => {
		const current = readConfig();
		const result = writeGippityControlConfig(
			{ ...current, voice: { ...current.voice, ...patch } },
			getGippityControlConfigPath(),
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
