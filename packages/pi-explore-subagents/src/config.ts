import fs from "node:fs";
import {
	ALLOWED_THINKING,
	DEFAULT_CONFIG,
	getAgentDir,
	getConfigPath,
	PACKAGE_CONFIG_PATH,
	TOOL_NAME,
} from "./constants.js";
import type {
	ChildRunDetails,
	ExploreConfig,
	ExploreMode,
	ExtensionConfig,
	UsageStats,
} from "./types.js";

function normalizeConfig(
	parsed: ExploreConfig | undefined,
	fallback: Required<ExploreConfig>,
): Required<ExploreConfig> {
	const model =
		typeof parsed?.model === "string" && parsed.model.trim()
			? parsed.model.trim()
			: fallback.model;
	const thinking =
		parsed?.thinking && ALLOWED_THINKING.has(parsed.thinking)
			? parsed.thinking
			: fallback.thinking;
	return { model, thinking };
}

function readPackageConfig(): Record<ExploreMode, Required<ExploreConfig>> {
	let parsed: ExtensionConfig | undefined;
	try {
		parsed = JSON.parse(
			fs.readFileSync(PACKAGE_CONFIG_PATH, "utf8"),
		) as ExtensionConfig;
	} catch {
		parsed = undefined;
	}

	return {
		shallow: normalizeConfig(parsed?.shallow, DEFAULT_CONFIG.shallow),
		deep: normalizeConfig(parsed?.deep, DEFAULT_CONFIG.deep),
	};
}

export function ensureConfigFile(): string {
	const agentDir = getAgentDir();
	const configPath = getConfigPath();
	fs.mkdirSync(agentDir, { recursive: true });
	if (!fs.existsSync(configPath)) {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify(readPackageConfig(), null, 2)}\n`,
			"utf8",
		);
	}
	return configPath;
}

export function readConfig(): Record<ExploreMode, Required<ExploreConfig>> {
	let parsed: ExtensionConfig;
	const configPath = ensureConfigFile();
	try {
		parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as ExtensionConfig;
	} catch (error) {
		throw new Error(
			`Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return {
		shallow: normalizeConfig(parsed.shallow, DEFAULT_CONFIG.shallow),
		deep: normalizeConfig(parsed.deep, DEFAULT_CONFIG.deep),
	};
}

export function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function createChildRunDetails(
	mode: ExploreMode,
	task: string,
	cwd: string,
	config = readConfig()[mode],
): ChildRunDetails {
	return {
		mode,
		toolName: TOOL_NAME,
		task,
		cwd,
		model: config.model,
		thinking: config.thinking,
		messages: [],
		stderr: "",
		exitCode: 0,
		usage: emptyUsage(),
	};
}

export function isSubagentFailure(
	details: Pick<ChildRunDetails, "exitCode" | "stopReason">,
): boolean {
	return (
		details.exitCode !== 0 ||
		details.stopReason === "error" ||
		details.stopReason === "aborted"
	);
}
