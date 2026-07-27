import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_FILENAME = "pi-auto-trees.json";
export const DEFAULT_SUMMARY_CONFIG = {
	enabled: true,
	model: "openai-codex/gpt-5.6-luna",
	thinking: "low",
} as const;

const ALLOWED_THINKING = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const);

export type SummaryThinking =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export interface SummaryModelConfig {
	enabled: boolean;
	model: string;
	thinking: SummaryThinking;
}

interface AutoTreesConfig {
	summary?: {
		enabled?: boolean;
		model?: string;
		thinking?: SummaryThinking;
	};
}

export function getConfigPath(): string {
	return path.join(getAgentDir(), CONFIG_FILENAME);
}

export function ensureConfigFile(): string {
	const configPath = getConfigPath();
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	if (!fs.existsSync(configPath)) {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify({ summary: DEFAULT_SUMMARY_CONFIG }, null, 2)}\n`,
			"utf8",
		);
	}
	return configPath;
}

export function readSummaryConfig(): SummaryModelConfig {
	const configPath = ensureConfigFile();
	let parsed: AutoTreesConfig;
	try {
		parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as AutoTreesConfig;
	} catch (error) {
		throw new Error(
			`Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const configured = parsed.summary;
	const model =
		typeof configured?.model === "string" && configured.model.trim()
			? configured.model.trim()
			: DEFAULT_SUMMARY_CONFIG.model;
	const thinking =
		configured?.thinking && ALLOWED_THINKING.has(configured.thinking)
			? configured.thinking
			: DEFAULT_SUMMARY_CONFIG.thinking;

	return {
		enabled:
			typeof configured?.enabled === "boolean"
				? configured.enabled
				: DEFAULT_SUMMARY_CONFIG.enabled,
		model,
		thinking,
	};
}
