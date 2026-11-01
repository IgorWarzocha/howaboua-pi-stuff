import { CODEX_CONVERSION_CONFIG_BASENAME } from "./adapter/activation/config-file.ts";
import {
	readCodexConversionConfig,
	writeCodexConversionConfig,
} from "./adapter/activation/config-file.ts";
import { createVoiceSettings } from "./voice/lan/settings-core.ts";
import { isAbsolute, join, resolve } from "node:path";

export interface HostSettingsIdentity {
	provider: "pcc";
	configPath: string;
}
export interface HostSettingsOptions {
	/** Use the host Pi SDK's getAgentDir(), never a project directory. */
	agentDir: string;
	/** Host Pi model registry's available catalog. */
	models: { provider: string; modelId: string }[];
	patch?: Record<string, unknown>;
	/** Required for writes; echo the identity from the last read. */
	identity?: HostSettingsIdentity;
}

/** Read or patch persisted global voice settings without starting Pi or voice. */
export async function hostSettings(options: HostSettingsOptions) {
	if (typeof options.agentDir !== "string" || !isAbsolute(options.agentDir))
		throw new Error("Provide the host Pi agent directory as an absolute path");
	if (
		!Array.isArray(options.models) ||
		options.models.some(
			(model) =>
				!model ||
				typeof model.provider !== "string" ||
				typeof model.modelId !== "string",
		)
	)
		throw new Error("Provide the host Pi model catalog");
	const configPath = join(
		resolve(options.agentDir),
		CODEX_CONVERSION_CONFIG_BASENAME,
	);
	const identity: HostSettingsIdentity = { provider: "pcc", configPath };
	if (options.patch !== undefined) {
		if (
			!options.patch ||
			typeof options.patch !== "object" ||
			Array.isArray(options.patch)
		)
			throw new Error("Provide a voice settings patch");
		if (
			options.identity?.provider !== identity.provider ||
			options.identity.configPath !== identity.configPath
		)
			throw new Error("Settings target changed; reload settings before saving");
	}
 const readConfig = () => readCodexConversionConfig(configPath, true);
	const settings = createVoiceSettings({
		readConfig,
		getConfig: readConfig,
		models: () => options.models,
		scope: () => "Global",
		saveVoice(patch) {
			const current = readConfig();
			const result = writeCodexConversionConfig(
				{ ...current, voice: { ...current.voice, ...patch } },
				configPath,
			);
			if (!result.ok)
				throw new Error(
					"Could not save voice settings; check the config file permissions and retry",
				);
		},
	});
	const snapshot =
		options.patch === undefined
			? settings.settings()
			: settings.configureSettings(options.patch);
	return { ...snapshot, scope: "Global" as const, identity };
}
