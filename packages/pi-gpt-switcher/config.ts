import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const SHORTCUT_ALIASES = ["sol", "terra", "luna"] as const;
export type ShortcutAlias = (typeof SHORTCUT_ALIASES)[number];
export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export const THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export type ShortcutDefaults = {
	contextWindow: number;
	reasoning: ThinkingLevel;
};

export type GptSwitcherConfig = Record<ShortcutAlias, ShortcutDefaults>;

export const DEFAULT_GPT_SWITCHER_CONFIG: GptSwitcherConfig = {
	sol: { contextWindow: 272_000, reasoning: "high" },
	terra: { contextWindow: 872_000, reasoning: "high" },
	luna: { contextWindow: 472_000, reasoning: "xhigh" },
};

const CONFIG_BASENAME = "pi-gpt-switcher.json";
const MAX_CONTEXT_WINDOW = 872_000;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configurationError(message: string): void {
	console.warn(`[pi-gpt-switcher] ${message}`);
}

function normalizeContextWindow(
	value: unknown,
	fallback: number,
	alias: ShortcutAlias,
): number {
	if (value === undefined) return fallback;
	if (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= MAX_CONTEXT_WINDOW
	)
		return value;
	configurationError(
		`${alias}.contextWindow must be a positive integer up to ${MAX_CONTEXT_WINDOW}; using the default`,
	);
	return fallback;
}

function normalizeReasoning(
	value: unknown,
	fallback: ThinkingLevel,
	alias: ShortcutAlias,
): ThinkingLevel {
	if (value === undefined) return fallback;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (THINKING_LEVELS.has(normalized as ThinkingLevel))
			return normalized as ThinkingLevel;
	}
	configurationError(
		`${alias}.reasoning must be a supported Pi thinking level; using the default`,
	);
	return fallback;
}

export function normalizeGptSwitcherConfig(value: unknown): GptSwitcherConfig {
	if (!isObject(value)) {
		configurationError("configuration must be a JSON object; using defaults");
		return structuredClone(DEFAULT_GPT_SWITCHER_CONFIG);
	}

	return Object.fromEntries(
		SHORTCUT_ALIASES.map((alias) => {
			const defaults = DEFAULT_GPT_SWITCHER_CONFIG[alias];
			const configured = value[alias];
			if (configured === undefined) return [alias, { ...defaults }];
			if (!isObject(configured)) {
				configurationError(`${alias} must be an object; using defaults`);
				return [alias, { ...defaults }];
			}
			return [
				alias,
				{
					contextWindow: normalizeContextWindow(
						configured["contextWindow"],
						defaults.contextWindow,
						alias,
					),
					reasoning: normalizeReasoning(
						configured["reasoning"],
						defaults.reasoning,
						alias,
					),
				},
			];
		}),
	) as GptSwitcherConfig;
}

export function getGptSwitcherConfigPath(
	agentDir: string = getAgentDir(),
): string {
	return join(agentDir, CONFIG_BASENAME);
}

export function ensureGptSwitcherConfig(
	configPath: string = getGptSwitcherConfigPath(),
): void {
	if (existsSync(configPath)) return;
	try {
		mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
		writeFileSync(
			configPath,
			`${JSON.stringify(DEFAULT_GPT_SWITCHER_CONFIG, null, 2)}\n`,
			{ encoding: "utf8", mode: 0o600, flag: "wx" },
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
		configurationError(
			`could not create ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function readGptSwitcherConfig(
	configPath: string = getGptSwitcherConfigPath(),
): GptSwitcherConfig {
	try {
		return normalizeGptSwitcherConfig(
			JSON.parse(readFileSync(configPath, "utf8")) as unknown,
		);
	} catch (error) {
		configurationError(
			`could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}; using defaults`,
		);
		return structuredClone(DEFAULT_GPT_SWITCHER_CONFIG);
	}
}
