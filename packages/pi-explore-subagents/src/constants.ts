import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ExploreConfig, ExploreMode, ThinkingLevel } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export const CONFIG_FILENAME = "pi-explore-subagents.json";
export const PACKAGE_CONFIG_PATH = path.join(ROOT_DIR, "config.json");
export const CHILD_ENV = "PI_EXPLORE_SUBAGENT_CHILD";
export const TOOL_NAME = "explore_subagent";
export const TOOL_LABEL = "Explore Subagent";

export const SHALLOW_PROMPT_PATH = path.join(ROOT_DIR, "shallow.prompt.md");
export const DEEP_PROMPT_PATH = path.join(ROOT_DIR, "deep.prompt.md");

export const DEFAULT_CONFIG: Record<ExploreMode, Required<ExploreConfig>> = {
	shallow: {
		model: "openai-codex/gpt-5.3-codex-spark",
		thinking: "low",
	},
	deep: {
		model: "openai-codex/gpt-5.4-mini",
		thinking: "medium",
	},
};

export const MODE_SPECS = {
	shallow: {
		label: "Shallow",
		shortDescription: "Tight, bounded scan. Find key files and stop early.",
		promptPath: SHALLOW_PROMPT_PATH,
		systemPreamble: "Stay strictly in discovery mode.",
	},
	deep: {
		label: "Deep",
		shortDescription:
			"Broad scan. Good for surveys, triage, and compare/rank work.",
		promptPath: DEEP_PROMPT_PATH,
		systemPreamble: "Stay strictly in discovery mode.",
	},
} as const;

export const ALLOWED_THINKING = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);
export const RPC_READY_TIMEOUT_MS = 10_000;
export const RPC_RESPONSE_TIMEOUT_MS = 30_000;

export function getAgentDir(): string {
	const configured = process.env["PI_CODING_AGENT_DIR"]?.trim();
	return configured || path.join(os.homedir(), ".pi", "agent");
}

export function getConfigPath(): string {
	return path.join(getAgentDir(), CONFIG_FILENAME);
}

export const ExploreModeSchema = StringEnum(["shallow", "deep"] as const, {
	description: "shallow | deep",
}) as any;

export const ExploreParams = Type.Object({
	task: Type.String({
		description: "Standalone task brief.",
	}),
	mode: ExploreModeSchema,
	cwd: Type.Optional(
		Type.String({ description: "Working directory. Defaults to current cwd." }),
	),
}) as any;
