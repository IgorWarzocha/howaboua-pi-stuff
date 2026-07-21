import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const RESCUE_DEFAULTS = {
	reasoning: "low",
} as const;

const REASONING_LEVELS = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export type RescueReasoning =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export interface RescueConfig {
	provider?: string | undefined;
	model?: string | undefined;
	reasoning?: RescueReasoning;
}

interface RawRescueConfig {
	provider?: unknown;
	model?: unknown;
	reasoning?: unknown;
}

interface RawSettings {
	rescue?: RawRescueConfig;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseRescueConfig(raw: unknown): RescueConfig {
	const input = raw && typeof raw === "object" ? (raw as RawRescueConfig) : {};
	const reasoning =
		typeof input.reasoning === "string" && REASONING_LEVELS.has(input.reasoning)
			? (input.reasoning as RescueReasoning)
			: RESCUE_DEFAULTS.reasoning;

	return {
		provider: optionalString(input.provider),
		model: optionalString(input.model),
		reasoning,
	};
}

export function readRescueConfig(): RescueConfig {
	const settingsPath = join(getAgentDir(), "settings.json");
	let parsed: RawSettings;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as RawSettings;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return parseRescueConfig(undefined);
		throw new Error(
			`Could not read ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return parseRescueConfig(
		parsed && typeof parsed === "object" ? parsed.rescue : undefined,
	);
}
