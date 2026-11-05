import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "./config.ts";
import {
	GIPPITY_CONTROL_CONFIG_BASENAME,
	readGippityControlConfig as readFileConfig,
	writeGippityControlConfig as writeFileConfig,
} from "./config-file.ts";
export function getGippityControlConfigPath(agentDir = getAgentDir()): string {
	return join(agentDir, GIPPITY_CONTROL_CONFIG_BASENAME);
}
export function readGippityControlConfig(
	configPath = getGippityControlConfigPath(),
): GippityControlConfig {
	return readFileConfig(configPath);
}
export function writeGippityControlConfig(
	config: GippityControlConfig,
	configPath = getGippityControlConfigPath(),
) {
	return writeFileConfig(config, configPath);
}
