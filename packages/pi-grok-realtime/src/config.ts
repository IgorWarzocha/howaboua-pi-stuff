import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	GROK_REALTIME_CONFIG_BASENAME,
	type GrokRealtimeConfig,
	readConfig as readFileConfig,
	writeConfig as writeFileConfig,
} from "./config-file.ts";

export {
	CONTEXT_REASONING,
	type GrokRealtimeConfig,
	MODELS,
	normalizeConfig,
	SPEEDS,
	VOICES,
} from "./config-file.ts";
export function readConfig(): GrokRealtimeConfig {
	return readFileConfig(join(getAgentDir(), GROK_REALTIME_CONFIG_BASENAME));
}
export function writeConfig(config: GrokRealtimeConfig): void {
	writeFileConfig(config, join(getAgentDir(), GROK_REALTIME_CONFIG_BASENAME));
}
