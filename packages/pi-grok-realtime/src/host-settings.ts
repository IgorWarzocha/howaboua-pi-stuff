import { isAbsolute, join, resolve } from "node:path";
import {
	GROK_REALTIME_CONFIG_BASENAME,
	normalizeConfig,
	readConfig,
	writeConfig,
} from "./config-file.ts";
import { grokSettingsSnapshot } from "./settings-snapshot.ts";

export interface HostSettingsIdentity {
	provider: "grok";
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
		GROK_REALTIME_CONFIG_BASENAME,
	);
	const identity: HostSettingsIdentity = { provider: "grok", configPath };
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
	let config = readConfig(configPath);
	if (options.patch !== undefined) {
		if (Object.hasOwn(options.patch, "access"))
			throw new Error("Change account access in Pi settings");
		config = normalizeConfig(options.patch, config);
		writeConfig(config, configPath);
	}
	return {
		...grokSettingsSnapshot(config, options.models),
		scope: "Global" as const,
		identity,
	};
}
